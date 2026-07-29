#!/usr/bin/env node
/**
 * Capture what the live catalog holds right now, as committed evidence.
 *
 * HAC-248's first method line is "preserve logs, versions, digests and raw
 * response evidence", and it earns that placement: this environment has been
 * observed changing on its own. On 2026-07-29 the catalog held 66 datasets with
 * no jaffle_shop at 08:44Z and 82 with jaffle at 11:53Z, with nobody on this
 * project having asked for it. Evidence that exists only inside a running
 * container is evidence one `docker volume rm` away from being unrecoverable.
 *
 * This is deliberately a *series* instrument, not a one-shot. Two observations
 * of a moving system tell you it moved; they do not tell you how often, in which
 * direction, or whether it is settling. Run it again whenever the environment is
 * touched, and whenever it is not.
 *
 * Read-only. It issues GraphQL queries and writes files under `evaluation/`. It
 * mutates no catalog state, which is what makes it safe to run at any time —
 * including immediately before a teardown, which is exactly when it matters.
 *
 *   node scripts/capture-catalog-baseline.mjs [--gms http://localhost:8080]
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const GMS = flag("gms", "http://localhost:8080");
const OUT = join(repoRoot, "evaluation/hac-248");

/** The two subjects every committed fixture and manifest is about. */
const SUBJECTS = [
  "urn:li:dataset:(urn:li:dataPlatform:dbt,jaffle_shop.main.customers,PROD)",
  "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)",
];

async function gql(query) {
  const response = await fetch(`${GMS}/api/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok || body.errors) {
    throw new Error(`GraphQL failed: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
  }
  return body.data;
}

/**
 * The digest is over the sorted URN set alone, deliberately.
 *
 * Degrees are excluded because they are a property of the query bound, not of
 * the topology: MCP's `max_hops: 3` collapses degree 4 into "3+" while returning
 * the same members. A digest including degree would report a difference between
 * two surfaces that agree about the graph, which is the opposite of what this is
 * for. Set membership is the thing that must not drift.
 *
 * The recipe matches `scripts/derive-readiness-manifest.mjs` exactly —
 * `sha256(JSON.stringify(sortedUrnArray))` — so a capture's digest can be
 * compared directly against a committed manifest's `expectedSetDigest` rather
 * than requiring both sets to be re-listed and diffed by hand. Verified equal
 * against `game_events.upstream.json` on 2026-07-29. A capture using its own
 * recipe would have produced a different hex string for identical data, which
 * reads as a discrepancy and is not one.
 */
const setDigest = (urns) => createHash("sha256").update(JSON.stringify([...urns].sort())).digest("hex");

async function lineage(urn, direction) {
  const data = await gql(`{
    searchAcrossLineage(input: { urn: ${JSON.stringify(urn)}, direction: ${direction}, query: "*", start: 0, count: 50 }) {
      total
      searchResults { degree entity { urn } }
    }
  }`);
  const results = data.searchAcrossLineage?.searchResults ?? [];
  const edges = results
    .map((r) => ({ urn: r.entity.urn, degree: r.degree ?? null }))
    .sort((a, b) => a.urn.localeCompare(b.urn));
  return { observedCount: edges.length, total: data.searchAcrossLineage?.total ?? null, edges, setDigest: setDigest(edges.map((e) => e.urn)) };
}

async function subject(urn) {
  const data = await gql(`{
    dataset(urn: ${JSON.stringify(urn)}) {
      urn lastIngested
      platform { name }
      schemaMetadata { fields { fieldPath } }
    }
  }`);
  const d = data.dataset;
  return {
    urn,
    present: d !== null,
    lastIngested: d?.lastIngested ?? null,
    lastIngestedIso: d?.lastIngested ? new Date(d.lastIngested).toISOString() : null,
    schemaFieldCount: d?.schemaMetadata?.fields?.length ?? null,
    upstream: await lineage(urn, "UPSTREAM"),
    downstream: await lineage(urn, "DOWNSTREAM"),
  };
}

/**
 * Recipes are captured, so redaction is not optional.
 *
 * A dbt recipe is normally paths and a corpus pin, but the sink block is where a
 * `token` lives, and nothing stops a future recipe carrying one. Committed
 * evidence must never be the thing that publishes a credential, so this walks the
 * parsed recipe and replaces any value under a secret-shaped key before it can
 * reach a file. Unparseable input is dropped rather than passed through — a
 * recipe this cannot read is a recipe it cannot redact.
 */
const SECRET_KEY = /token|password|secret|credential|api[_-]?key/i;
const redact = (value) => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[REDACTED]" : redact(v)]),
    );
  }
  return value;
};
const redactedRecipe = (raw) => {
  if (typeof raw !== "string") return null;
  try {
    return redact(JSON.parse(raw));
  } catch {
    return { _unparseable: true, _note: "recipe was not JSON; withheld rather than copied unredacted" };
  }
};

/**
 * The ingestion audit trail.
 *
 * `evaluation/lineage-readiness-signals.md` records that "CLI `datahub ingest`
 * creates no execution request at all. There is nothing to poll." Measured again
 * on 2026-07-29 against GMS v1.5.0.6, that is not what this instance does: a
 * `[CLI] dbt` source carries a SUCCESS execution request for every CLI ingest,
 * including the 01:32:27Z run that produced the readiness manifests and the
 * 10:47:45Z run that reintroduced jaffle.
 *
 * That makes this the one place the environment's history is recorded, which is
 * why it is captured here rather than left to the doc's conclusion. The doc's
 * *other* claim still holds — the 15-minute FAILURE cron is `datahub-documents`
 * and `datahub-gc`, unrelated to this project.
 *
 * **The per-execution recipe is the field that makes a teardown reversible, and
 * it is the field that decays.** Discovered 2026-07-29: DataHub's CLI keys its
 * generated source by a hash of the pipeline, so every `datahub ingest` of the
 * same source type writes the *same* `[CLI] dbt` source URN and overwrites that
 * source's stored recipe in place. The source-level recipe therefore describes
 * only the most recent run — on this instance it reads as jaffle, and the
 * transfermarkt recipe that actually built the demo corpus is no longer there.
 *
 * It survives one level down: each `executionRequest` keeps the recipe it ran
 * with, so the 01:32:27Z transfermarkt ingest is still recoverable. That history
 * is not permanent either — `datahub-gc` runs `execution_request_cleanup` with
 * `keep_history_min_count: 10` and `keep_history_max_days: 90`. So this captures
 * the per-run recipe, not just the run's outcome. Capturing the outcome alone
 * records *that* the corpus was ingested while losing *how*, which is the half
 * that cannot be reconstructed from a rebuilt instance.
 */
async function ingestion() {
  const data = await gql(`{
    listIngestionSources(input: { start: 0, count: 25 }) {
      total
      ingestionSources {
        urn name type
        config { recipe version executorId }
        executions(start: 0, count: 10) {
          executionRequests {
            id
            input { requestedAt actorUrn arguments { key value } }
            result { status startTimeMs durationMs }
          }
        }
      }
    }
  }`);
  return (data.listIngestionSources?.ingestionSources ?? []).map((s) => ({
    name: s.name,
    type: s.type,
    // Latest-run-wins, per the note above. Kept so a capture shows what the
    // source claims alongside what each run actually did.
    currentSourceRecipe: redactedRecipe(s.config?.recipe),
    cliVersion: s.config?.version || null,
    executions: (s.executions?.executionRequests ?? []).map((e) => {
      const args = Object.fromEntries((e.input?.arguments ?? []).map((a) => [a.key, a.value]));
      return {
        status: e.result?.status ?? null,
        startTimeMs: e.result?.startTimeMs ?? null,
        startedIso: e.result?.startTimeMs ? new Date(e.result.startTimeMs).toISOString() : null,
        durationMs: e.result?.durationMs ?? null,
        actorUrn: e.input?.actorUrn ?? null,
        cliVersion: args.version ?? null,
        recipe: redactedRecipe(args.recipe),
      };
    }).sort((a, b) => (b.startTimeMs ?? 0) - (a.startTimeMs ?? 0)),
  }));
}

async function counts() {
  const all = await gql(`{ searchAcrossEntities(input: { types: [DATASET], query: "*", start: 0, count: 0 }) { total } }`);
  const byCorpus = {};
  for (const term of ["jaffle_shop", "transfermarkt", "duck.dev", "duck.transfermarkt_scraper"]) {
    const d = await gql(`{ searchAcrossEntities(input: { types: [DATASET], query: ${JSON.stringify(term)}, start: 0, count: 0 }) { total } }`);
    byCorpus[term] = d.searchAcrossEntities?.total ?? null;
  }
  return { datasetsTotal: all.searchAcrossEntities?.total ?? null, byQuery: byCorpus };
}

const capturedAt = new Date().toISOString();
const config = await fetch(`${GMS}/config`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null);

const baseline = {
  capturedAt,
  gms: {
    url: GMS,
    serverType: config?.datahub?.serverType ?? null,
    serverEnv: config?.datahub?.serverEnv ?? null,
    versions: config?.versions ?? null,
  },
  counts: await counts(),
  ingestion: await ingestion(),
  subjects: [],
};
for (const urn of SUBJECTS) baseline.subjects.push(await subject(urn));

mkdirSync(OUT, { recursive: true });
const body = `${JSON.stringify(baseline, null, 2)}\n`;
const stamp = capturedAt.replace(/[:.]/g, "-");
const file = `catalog-baseline-${stamp}.json`;
writeFileSync(join(OUT, file), body);
writeFileSync(join(OUT, `${file.replace(/\.json$/, "")}.provenance.json`), `${JSON.stringify({
  fixture: file,
  capturedAt,
  generated_by: "scripts/capture-catalog-baseline.mjs",
  command: `node scripts/capture-catalog-baseline.mjs --gms ${GMS}`,
  readOnly: true,
  note: "A point observation of a live catalog that has been seen to change without this project acting. Meaningful as a series; a single capture states one moment and nothing about stability.",
  fixtureSha256: createHash("sha256").update(body).digest("hex"),
}, null, 2)}\n`);

console.log(`${file}`);
console.log(`  datasets: ${baseline.counts.datasetsTotal}  (${Object.entries(baseline.counts.byQuery).map(([k, v]) => `${k}=${v}`).join(", ")})`);
for (const s of baseline.subjects) {
  console.log(`  ${s.present ? "present" : "ABSENT "} ${s.urn.slice(0, 78)}`);
  console.log(`     up ${s.upstream.observedCount} / down ${s.downstream.observedCount}  ingested ${s.lastIngestedIso ?? "?"}`);
  console.log(`     upstream set digest ${s.upstream.setDigest.slice(0, 16)}…`);
}
