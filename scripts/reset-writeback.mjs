#!/usr/bin/env node
/**
 * Return a dataset to the state it was in before this tool enriched it, and
 * prove the owned state is gone.
 *
 * This is the command that makes the writeback demonstration repeatable. Without
 * it the only way back to a pre-enrichment instance is `datahub docker nuke`
 * followed by a full re-ingest — minutes of container startup to re-prove one
 * mutation, which in practice means the demonstration gets run once and trusted
 * thereafter.
 *
 * It is deliberately narrow. It removes the link this tool wrote, under the
 * label this tool defines, and the one structured property this tool owns. It
 * has no vocabulary for anything else: no wildcard, no prefix, no "clear this
 * entity". The catalog it runs against holds metadata authored by ingestion and
 * by people, and a reset that could reach that is not a reset, it is a hazard.
 *
 * The owned boundary is not just enforced in code, it is printed in the receipt,
 * so a reviewer checking what this is permitted to touch does not have to read
 * the source to find out.
 *
 * Usage:
 *   node scripts/reset-writeback.mjs <urn|event.json> [--gms URL] [--dry-run]
 *                                    [--out FILE] [--verify-timeout MS]
 *
 * Exit codes:
 *   0  cleared, already clean, or a dry run
 *   1  the owned state survived the reset, or a mutation or read failed
 *   2  usage error
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const DRY = argv.includes("--dry-run");
const GMS = flag("gms", "http://localhost:8080");
const OUT = flag("out", null);
const duration = (name, fallback) => {
  const value = Number(flag(name, fallback));
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`--${name} must be a positive number of milliseconds; using ${fallback}`);
    return fallback;
  }
  return value;
};
const VERIFY_TIMEOUT_MS = duration("verify-timeout", 60_000);
const VERIFY_INTERVAL_MS = duration("verify-interval", 3_000);
const REQUEST_TIMEOUT_MS = 30_000;

// tsx is registered up front rather than as a fallback. `writeback-reset.ts`
// imports `./writeback.js` for the two constants that define the ownership
// boundary, and Node's own type-stripping does not rewrite that specifier — so
// the failure happens while linking the module graph, where a `.catch` on the
// dynamic import does not reliably get to retry it.
await import("tsx/esm/api").then((api) => api.register());

const load = async (specifier) => import(join(repoRoot, specifier));

const { EVIDENCE_TIER_PROPERTY_ID, LINK_LABEL } = await load("src/integration/writeback.ts");
const {
  planReset,
  ownsAnything,
  deriveResetDisposition,
  ownershipStatement,
} = await load("src/integration/writeback-reset.ts");

// The subject may be given as a bare URN or as an event, so the same argument
// that ran the writeback can undo it.
const positional = argv.find((a) => !a.startsWith("-") && (a.startsWith("urn:") || a.endsWith(".json")));
if (!positional) {
  console.error("usage: node scripts/reset-writeback.mjs <urn|event.json> [--gms URL] [--dry-run]");
  process.exit(2);
}
let urn = positional;
if (positional.endsWith(".json")) {
  try {
    urn = JSON.parse(readFileSync(resolve(positional), "utf8")).subject?.urn;
  } catch (error) {
    console.error(`could not read a subject URN from ${positional}: ${error.message}`);
    process.exit(2);
  }
  if (typeof urn !== "string" || !urn.startsWith("urn:")) {
    console.error(`${positional} carries no subject.urn`);
    process.exit(2);
  }
}

async function gql(query, variables = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  try {
    const response = await fetch(`${GMS}/api/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, body: null, error: `HTTP ${response.status}: non-JSON response ${text.slice(0, 200)}` };
    }
    if (body.errors) return { ok: false, body, error: JSON.stringify(body.errors).slice(0, 300) };
    if (!response.ok) return { ok: false, body, error: `HTTP ${response.status}` };
    return { ok: true, body, error: null };
  } catch (e) {
    return { ok: false, body: null, error: `${e.name}: ${e.message}` };
  }
}

/**
 * Read only the two things this tool owns.
 *
 * The query is scoped to them deliberately. Reading the whole entity and
 * filtering afterwards would put metadata this command must never touch into
 * the receipt it prints.
 */
async function readOwnedState(timeoutMs = REQUEST_TIMEOUT_MS) {
  const { ok, body, error } = await gql(
    `query($urn: String!) {
      dataset(urn: $urn) {
        institutionalMemory { elements { url label } }
        structuredProperties { properties { structuredProperty { urn } values { ... on StringValue { stringValue } } } }
      }
    }`,
    { urn },
    timeoutMs,
  );

  if (!ok) return { linkUrl: null, evidenceTier: null, read: "failed", readError: error ?? "unknown read failure" };

  const ds = body?.data?.dataset;
  if (ds === undefined) {
    return { linkUrl: null, evidenceTier: null, read: "failed", readError: "response carried no dataset field" };
  }

  const linkUrl =
    (ds?.institutionalMemory?.elements ?? []).find((e) => e.label === LINK_LABEL)?.url ?? null;
  const tierProperty = (ds?.structuredProperties?.properties ?? []).find((p) =>
    p.structuredProperty?.urn?.includes(EVIDENCE_TIER_PROPERTY_ID),
  );
  return {
    linkUrl,
    evidenceTier: tierProperty?.values?.[0]?.stringValue ?? null,
    read: "ok",
    readError: null,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Read back until the owned state is gone, or the bound elapses.
 *
 * Same reasoning as the writeback's observation loop, in the opposite direction:
 * an accepted removal is not a removal a reader can see yet, and a reset that
 * claimed `cleared` on the strength of an accepted mutation would leave the next
 * writeback observing a `noop` against state that was supposed to be gone.
 */
async function verifyAbsent() {
  const startedAt = Date.now();
  let polls = 0;
  let state;
  for (;;) {
    const remainingMs = VERIFY_TIMEOUT_MS - (Date.now() - startedAt);
    state = await readOwnedState(Math.max(1, Math.min(REQUEST_TIMEOUT_MS, remainingMs)));
    polls += 1;
    const elapsedMs = Date.now() - startedAt;
    if (state.read === "ok" && !ownsAnything(state)) {
      return { state, record: { polls, elapsedMs, timeoutMs: VERIFY_TIMEOUT_MS } };
    }
    if (elapsedMs + VERIFY_INTERVAL_MS >= VERIFY_TIMEOUT_MS) {
      return { state, record: { polls, elapsedMs, timeoutMs: VERIFY_TIMEOUT_MS } };
    }
    await sleep(VERIFY_INTERVAL_MS);
  }
}

const before = await readOwnedState();
const plan = planReset(urn, before);
const attempts = [];

if (!DRY) {
  for (const step of plan) {
    const query =
      step.mutation === "removeLink"
        ? `mutation($input: RemoveLinkInput!) { removeLink(input: $input) }`
        : `mutation($input: RemoveStructuredPropertiesInput!) { removeStructuredProperties(input: $input) { properties { structuredProperty { urn } } } }`;
    const { ok, body, error } = await gql(query, step.variables);
    attempts.push({
      mutation: step.mutation,
      variables: step.variables,
      succeeded: ok,
      response: (ok ? JSON.stringify(body.data) : (error ?? "unknown failure")).slice(0, 400),
    });
  }
}

// Nothing was applied, so there is nothing to verify. `after` repeats `before`
// rather than inventing a second reading nobody took.
const verified =
  DRY || plan.length === 0 || attempts.some((a) => !a.succeeded)
    ? { state: before, record: null }
    : await verifyAbsent();

const receipt = {
  targetUrn: urn,
  actor: { tool: "@workspacejson/datahub-agent", version: "0.0.1" },
  attemptedAt: new Date().toISOString(),
  owns: ownershipStatement(),
  before,
  after: verified.state,
  attempts,
  observation: verified.record,
  disposition: DRY
    ? "dry-run"
    : deriveResetDisposition({ before, after: verified.state, attempts }),
};

const json = `${JSON.stringify(receipt, null, 2)}\n`;
if (OUT) {
  writeFileSync(resolve(OUT), json);
  console.error(`written to ${OUT}`);
} else {
  process.stdout.write(json);
}

const describe = (s) =>
  s.read !== "ok"
    ? `UNREADABLE (${s.readError})`
    : `link=${s.linkUrl ? "present" : "absent"} tier=${s.evidenceTier ?? "unset"}`;

console.error(`\ntarget       ${urn}`);
console.error(`owns         link "${receipt.owns.linkLabel}" + property ${receipt.owns.structuredPropertyId}`);
console.error(`mode         ${DRY ? "dry-run" : "applied"}`);
console.error(`before       ${describe(before)}`);
console.error(`after        ${describe(receipt.after)}`);
if (plan.length === 0) console.error(`plan         nothing owned was present`);
for (const a of attempts) console.error(`  ${a.succeeded ? "ok  " : "FAIL"} ${a.mutation}  ${a.response.slice(0, 110)}`);
if (verified.record) {
  const { polls, elapsedMs, timeoutMs } = verified.record;
  console.error(`verified     ${polls} read(s) in ${elapsedMs}ms (bound ${timeoutMs}ms)`);
}
console.error(`disposition  ${receipt.disposition}`);

process.exit(DRY || receipt.disposition === "cleared" || receipt.disposition === "already-clean" ? 0 : 1);
