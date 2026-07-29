#!/usr/bin/env node
/**
 * HAC-231: derive a pinned lineage readiness manifest from a dbt manifest.
 *
 * This is the "separate explicit command" the issue's governance requires.
 * Ordinary capture is read-only with respect to manifests; nothing here runs as
 * part of an emit. It is deliberately NOT folded into
 * `scripts/build-corpus-fixture.mjs`, which is pinned to jaffle_shop_duckdb and
 * refuses other checkouts by design — see the note there.
 *
 * ## Direction of derivation
 *
 * Expected URNs are computed from the pinned dbt manifest using DataHub's own
 * documented construction rules, transcribed from the pinned ingestion source.
 * **No expected URN is ever read out of DataHub.** `--verify` compares the
 * derived set against a live catalog, but that is verification after the fact;
 * a mismatch fails, it never rewrites the expectation.
 *
 * Reading URNs out of the catalog and matching by name would make the expected
 * set derive from the same catalog it is meant to check. The gate would then be
 * self-confirming: a wrong catalog produces a wrong expectation in the same way,
 * and the comparison passes. That fallback is forbidden — if the official
 * mapping ever stops reproducing, write a corpus-specific mapping and document
 * it as corpus-specific instead.
 *
 * ## The two edge types
 *
 * DataHub's dbt source emits each non-ephemeral, non-test node twice — once on
 * the `dbt` platform and once on the target platform — and the lineage graph
 * alternates between them. Both rules are transcribed from
 * `dbt_common.py:1173-1206` (`get_urn_for_upstream_lineage`) and validated
 * against the observed degree distribution in
 * `evaluation/hac-231/hop-semantics-gate.md`.
 *
 *   1. depends_on. For a dbt model X depending on node Y, X's upstream is
 *      `dbt:Y`   if Y is ephemeral, or Y is a source and skip_sources_in_lineage
 *                is off (the default);
 *      `<target>:Y` otherwise.
 *
 *   2. sibling. The logical dbt node and the physical target-platform table are
 *      siblings, oriented by which produces which:
 *        model  -> `<target>:X` has upstream `dbt:X`  (the model builds the table)
 *        source -> `dbt:X` has upstream `<target>:X`  (the table feeds the source)
 *
 * Usage:
 *   node scripts/derive-readiness-manifest.mjs <checkout> \
 *     --subject <dbt-unique-id|urn> --direction UPSTREAM|DOWNSTREAM \
 *     [--max-degree 4] [--out <path>] [--verify --gms http://localhost:8080]
 *
 * Exit codes:
 *   0  manifest derived (and verified, if --verify was passed)
 *   1  --verify was passed and the derived set does not match the catalog
 *   2  usage / precondition failure
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// --- configuration transcribed from the ingestion recipe ---------------------
//
// `scripts/reproduce-hac-152-live.sh` sets target_platform and git_info and
// nothing else, so DataHub's own defaults apply for everything below.
//
// convert_urns_to_lowercase is PINNED here rather than inherited, because the
// two defaults in the pinned source disagree: the config field defaults to True
// (dbt_common.py:557) while the DBTNode dataclass defaults to False (:1129).
// Every component in this corpus is already lowercase, so the setting is a
// no-op for it and no observation can distinguish the two. Pinning makes the
// untested branch unreachable rather than merely unexercised — if the emitter
// ever ran the other path against a mixed-case corpus, the manifest would
// silently stop matching.
const CONFIG = {
  targetPlatform: "duckdb",
  env: "PROD",
  useIdentifiers: false,
  includeDatabaseName: true,
  convertUrnsToLowercase: false, // PINNED, not inherited. See above.
  skipSourcesInLineage: false,
  dbtPlatform: "dbt",
};

const PINNED = {
  repository: "https://github.com/dcaribou/transfermarkt-datasets",
  sha: "59fa295c51fc23466f3a71542f8bf3d1335daa83",
};

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const has = (n) => argv.includes(`--${n}`);

const checkout = argv.find((a) => !a.startsWith("--") && !argv[argv.indexOf(a) - 1]?.startsWith("--"));
const SUBJECT = flag("subject", "model.transfermarkt_datasets.game_events");
const DIRECTION = (flag("direction", "UPSTREAM") || "").toUpperCase();
const MAX_DEGREE = Number(flag("max-degree", "4"));
const OUT = flag("out", null);
const VERIFY = has("verify");
const GMS = flag("gms", "http://localhost:8080");

if (!checkout) { console.error("usage: derive-readiness-manifest.mjs <checkout> --subject <id> --direction UPSTREAM|DOWNSTREAM"); process.exit(2); }
if (!["UPSTREAM", "DOWNSTREAM"].includes(DIRECTION)) { console.error(`--direction must be UPSTREAM or DOWNSTREAM; got ${JSON.stringify(DIRECTION)}`); process.exit(2); }

const manifestPath = join(resolve(checkout), "dbt/target/manifest.json");
const altPath = join(resolve(checkout), "target/manifest.json");
const mPath = existsSync(manifestPath) ? manifestPath : altPath;
if (!existsSync(mPath)) { console.error(`No dbt manifest at ${manifestPath} or ${altPath}. Run \`dbt docs generate\` first.`); process.exit(2); }

// Refuse to derive a pinned expectation from an unpinned tree. A manifest whose
// provenance cannot be stated is not an oracle.
let sha = null;
try { sha = execFileSync("git", ["-C", resolve(checkout), "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
if (sha !== PINNED.sha) {
  console.error(`Checkout is at ${sha ?? "(not a git checkout)"}, not the pinned ${PINNED.sha}.`);
  console.error("Refusing to derive a pinned manifest from an unpinned tree.");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(mPath, "utf8"));

// --- URN construction (dbt_core.py:251-261, dbt_common.py:1136-1157) ---------

const isEphemeral = (n) => n.config?.materialized === "ephemeral";

function dbFqn(node) {
  const name =
    CONFIG.useIdentifiers && node.identifier ? node.identifier
    : node.alias != null && node.resource_type !== "test" ? node.alias
    : node.name;
  const database = CONFIG.includeDatabaseName ? node.database : null;
  let fqn = [database, node.schema, name].filter(Boolean).join(".").replaceAll('"', "");
  if (CONFIG.convertUrnsToLowercase) fqn = fqn.toLowerCase();
  return fqn;
}
const urn = (platform, fqn) => `urn:li:dataset:(urn:li:dataPlatform:${platform},${fqn},${CONFIG.env})`;

// --- node table --------------------------------------------------------------

const nodes = new Map();
for (const [id, n] of Object.entries(manifest.nodes ?? {})) {
  if (n.resource_type !== "model") continue;   // tests do not exist in the target platform
  nodes.set(id, { ...n, _kind: "model" });
}
for (const [id, n] of Object.entries(manifest.sources ?? {})) nodes.set(id, { ...n, _kind: "source" });

/** Which URN a dbt node is referenced by when it appears as someone's upstream. */
function upstreamUrnFor(id) {
  const n = nodes.get(id);
  if (!n) return null;
  const fqn = dbFqn(n);
  if (isEphemeral(n)) return urn(CONFIG.dbtPlatform, fqn);
  if (n._kind === "source" && !CONFIG.skipSourcesInLineage) return urn(CONFIG.dbtPlatform, fqn);
  return urn(CONFIG.targetPlatform, fqn);
}

// --- build the URN-space edge set -------------------------------------------
// upstreams: Map<urn, Set<urn>> — "this URN has these as direct upstreams".

const upstreams = new Map();
const addEdge = (downstream, upstream) => {
  if (!downstream || !upstream || downstream === upstream) return;
  if (!upstreams.has(downstream)) upstreams.set(downstream, new Set());
  upstreams.get(downstream).add(upstream);
};

for (const [id, n] of nodes) {
  const fqn = dbFqn(n);
  const dbtUrn = urn(CONFIG.dbtPlatform, fqn);
  const targetUrn = urn(CONFIG.targetPlatform, fqn);

  // Rule 1 — depends_on. Only models declare dependencies.
  if (n._kind === "model") {
    for (const dep of n.depends_on?.nodes ?? []) {
      if (!nodes.has(dep)) continue;           // macros and tests are not datasets
      addEdge(dbtUrn, upstreamUrnFor(dep));
    }
  }

  // Rule 2 — sibling, oriented by which side produces which.
  if (isEphemeral(n)) continue;                // ephemeral nodes exist only in dbt
  if (n._kind === "model") addEdge(targetUrn, dbtUrn);
  else addEdge(dbtUrn, targetUrn);
}

// Invert once for DOWNSTREAM traversal.
const downstreams = new Map();
for (const [d, ups] of upstreams) for (const u of ups) {
  if (!downstreams.has(u)) downstreams.set(u, new Set());
  downstreams.get(u).add(d);
}

// --- resolve the subject -----------------------------------------------------

let subjectUrn;
if (SUBJECT.startsWith("urn:")) subjectUrn = SUBJECT;
else {
  const n = nodes.get(SUBJECT);
  if (!n) { console.error(`Subject ${SUBJECT} is not a model or source in the manifest.`); process.exit(2); }
  subjectUrn = urn(CONFIG.dbtPlatform, dbFqn(n));
}

// --- bounded closure ---------------------------------------------------------

const adjacency = DIRECTION === "UPSTREAM" ? upstreams : downstreams;
const byDegree = new Map();
const seen = new Set([subjectUrn]);
let frontier = [subjectUrn];
for (let degree = 1; degree <= MAX_DEGREE && frontier.length; degree += 1) {
  const next = [];
  for (const node of frontier) {
    for (const neighbour of adjacency.get(node) ?? []) {
      if (seen.has(neighbour)) continue;
      seen.add(neighbour);
      next.push(neighbour);
      if (!byDegree.has(degree)) byDegree.set(degree, []);
      byDegree.get(degree).push(neighbour);
    }
  }
  frontier = next;
}

const expectedUrns = [...seen].filter((u) => u !== subjectUrn).sort();

// --- emit --------------------------------------------------------------------

const canonicalJson = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const r = v;
    return `{${Object.keys(r).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(r[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
};
const digest = (v) => createHash("sha256").update(canonicalJson(v)).digest("hex");

const queryParameters = {
  surface: "searchAcrossLineage",
  direction: DIRECTION,
  maxDegree: MAX_DEGREE,
  query: "*",
  start: 0,
  count: 50,
};

const readinessManifest = {
  expectedUrns,
  queryParameters,
  _provenance: {
    subject: subjectUrn,
    subjectDbtUniqueId: SUBJECT.startsWith("urn:") ? null : SUBJECT,
    corpus: PINNED.repository,
    commit: PINNED.sha,
    dbt_version: manifest.metadata?.dbt_version ?? null,
    adapter_type: manifest.metadata?.adapter_type ?? null,
    ingestion_source: "acryl-datahub 1.6.0.16",
    derivation: "scripts/derive-readiness-manifest.mjs",
    command: `node scripts/derive-readiness-manifest.mjs <checkout-at-${PINNED.sha.slice(0, 8)}> --subject ${SUBJECT} --direction ${DIRECTION} --max-degree ${MAX_DEGREE}`,
    urn_rule: "dbt_core.py:251-261 + dbt_common.py:1136-1157, 1173-1206",
    config: CONFIG,
    derivedFrom: "pinned dbt manifest.json — never from an observed DataHub response",
    degrees: Object.fromEntries([...byDegree].map(([d, u]) => [d, u.sort()])),
    caveat:
      "convert_urns_to_lowercase is pinned to false, not inherited: the pinned source's " +
      "config default (True) and DBTNode default (False) disagree. Every component in this " +
      "corpus is lowercase, so no observation distinguishes them. The lowercase and " +
      "quote-stripping branches of get_db_fqn are UNTESTED, not proven. Re-establish before " +
      "porting to a mixed-case corpus or a case-sensitive platform.",
  },
};
readinessManifest._provenance.expectedSetDigest = digest([...expectedUrns].sort());
readinessManifest._provenance.manifestDigest = digest({ expectedUrns: [...expectedUrns].sort(), queryParameters });

console.log(`subject:     ${subjectUrn}`);
console.log(`direction:   ${DIRECTION}  (to degree ${MAX_DEGREE})`);
console.log(`corpus:      ${PINNED.repository}@${PINNED.sha.slice(0, 8)}`);
console.log(`expected:    ${expectedUrns.length} URNs`);
for (const [d, us] of [...byDegree].sort((a, b) => a[0] - b[0])) {
  console.log(`  degree ${d}: ${us.length}`);
  for (const u of us.sort()) console.log(`    ${u}`);
}
console.log(`expectedSetDigest: ${readinessManifest._provenance.expectedSetDigest}`);
console.log(`manifestDigest:    ${readinessManifest._provenance.manifestDigest}`);

if (OUT) {
  mkdirSync(dirname(resolve(OUT)), { recursive: true });
  writeFileSync(resolve(OUT), `${JSON.stringify(readinessManifest, null, 2)}\n`);
  console.log(`written to:  ${OUT}`);
}

// --- optional verification (never rewrites the expectation) ------------------

if (!VERIFY) process.exit(0);

const query = `{ searchAcrossLineage(input:{ urn:${JSON.stringify(subjectUrn)}, direction:${DIRECTION}, query:"*", start:0, count:50 }) { searchResults { degree entity { urn } } } }`;
const res = await fetch(`${GMS}/api/graphql`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query }), signal: AbortSignal.timeout(30_000),
});
const body = await res.json();
if (!res.ok || body.errors) { console.error(`\nVerification read failed: ${JSON.stringify(body.errors ?? body).slice(0, 200)}`); process.exit(2); }

const observed = [...new Set((body.data.searchAcrossLineage.searchResults ?? []).map((r) => r.entity.urn))].sort();
const missing = expectedUrns.filter((u) => !observed.includes(u));
const unexpected = observed.filter((u) => !expectedUrns.includes(u));

console.log(`\n--- verification against ${GMS} ---`);
console.log(`observed:    ${observed.length} URNs`);
console.log(`expected but not observed: ${missing.length}`);
for (const u of missing) console.log(`  ${u}`);
console.log(`observed but not expected: ${unexpected.length}`);
for (const u of unexpected) console.log(`  ${u}`);

const match = missing.length === 0 && unexpected.length === 0;
console.log(`\n${match ? "MATCH — derived set reproduces the catalog exactly." : "MISMATCH — derived set does not reproduce the catalog."}`);
console.log(`observedSetDigest: ${digest(observed)}`);
process.exit(match ? 0 : 1);
