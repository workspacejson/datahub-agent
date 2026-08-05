#!/usr/bin/env node
/**
 * Execute the OSS-safe enrichment writeback against a live DataHub and emit a
 * receipt.
 *
 * Reads before-state, plans the mutations, applies them, observes the
 * after-state until it carries what was intended, and records every attempt. A
 * receipt is produced whether or not the write succeeded — a silent failure is
 * the outcome this is built to prevent. That promise is why no transport error
 * is allowed to escape: an exception thrown past the receipt would be exactly
 * the silent failure this exists to avoid.
 *
 * The after-state is polled rather than read once because DataHub applies a
 * mutation and serves a stale read for some time afterwards — minutes, on the
 * convergence measured in HAC-221. A single read would make an honest receipt
 * flaky: correct writes reported as failures. Polling to a bound keeps the
 * claim honest without making it noise, and the bound itself is recorded so a
 * timeout can be read against it.
 *
 * The enriched event goes to stdout unless --out names a file, so the default
 * invocation can be piped or retained. Diagnostics stay on stderr.
 *
 * Usage:
 *   node scripts/run-writeback.mjs <event.json> [--gms URL] [--dry-run] [--out FILE]
 *                                  [--observe-timeout MS] [--observe-interval MS]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const DRY = argv.includes("--dry-run");
const GMS = flag("gms", "http://localhost:8080");
const OUT = flag("out", null);
// A non-numeric bound would make the observation loop unbounded, which is the
// one way this script could hang instead of emitting a receipt.
const duration = (name, fallback) => {
  const value = Number(flag(name, fallback));
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`--${name} must be a positive number of milliseconds; using ${fallback}`);
    return fallback;
  }
  return value;
};
const OBSERVE_TIMEOUT_MS = duration("observe-timeout", 120_000);
const OBSERVE_INTERVAL_MS = duration("observe-interval", 3_000);
const eventPath =
  argv.find((a) => a.endsWith(".json")) ??
  join(repoRoot, "test/fixtures/golden/change-impact-event.nested.json");

// tsx is registered up front rather than as a fallback, for the same reason
// `reset-writeback.mjs` does it: `writeback.ts` now imports `./change-impact-event.js`
// for the evidence lattice the deployed property definition is built from, and
// Node's own type-stripping does not rewrite that specifier — so the failure
// happens while linking the module graph, where a `.catch` on the dynamic
// import does not reliably get to retry it.
await import("tsx/esm/api").then((api) => api.register());

const {
  planWriteback,
  refusalReason,
  redact,
  attachReceipt,
  deriveOutcome,
  intendedState,
  matchesIntent,
  notQueriedState,
  unreadableState,
  LINK_LABEL,
  EVIDENCE_TIER_PROPERTY_ID, linkOmission,
  EVIDENCE_TIER_PROPERTY_DEFINITION,
  reconcileDeployedDefinition,} = await import(join(repoRoot, "src/integration/writeback.ts"));

const event = JSON.parse(readFileSync(resolve(eventPath), "utf8"));

/**
 * Post a GraphQL document, and never throw.
 *
 * Transport failure, a non-JSON body and a GraphQL error all come back as
 * `ok: false` with the detail preserved, so every caller reaches the receipt.
 */
/** Default ceiling for any single request that is not inside an observation budget. */
const REQUEST_TIMEOUT_MS = 30_000;

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
      return {
        ok: false,
        body: null,
        error: `HTTP ${response.status}: non-JSON response ${text.slice(0, 200)}`,
      };
    }
    if (body.errors) {
      return { ok: false, body, error: JSON.stringify(body.errors).slice(0, 300) };
    }
    if (!response.ok) {
      return { ok: false, body, error: `HTTP ${response.status}` };
    }
    return { ok: true, body, error: null };
  } catch (e) {
    return { ok: false, body: null, error: `${e.name}: ${e.message}` };
  }
}

/**
 * Read the state this writeback would change.
 *
 * A failed read returns `read: "failed"` rather than nulls that would be
 * indistinguishable from a catalog holding nothing. Recording an unreachable
 * instance as an empty one would manufacture a clean before/after pair for a
 * write that never landed.
 */
async function readState(urn, timeoutMs = REQUEST_TIMEOUT_MS) {
  const { ok, body, error } = await gql(`query($urn: String!) {
    dataset(urn: $urn) {
      institutionalMemory { elements { url label } }
      structuredProperties { properties { structuredProperty { urn } values { ... on StringValue { stringValue } } } }
    }
  }`, { urn }, timeoutMs);

  if (!ok) return unreadableState(error ?? "unknown read failure");

  const ds = body?.data?.dataset;
  if (ds === undefined) return unreadableState("response carried no dataset field");

  // A null dataset is a real answer: the entity is not in the catalog.
  const link =
    (ds?.institutionalMemory?.elements ?? []).find((e) => e.label === LINK_LABEL)?.url ?? null;
  const tierProp = (ds?.structuredProperties?.properties ?? []).find((p) =>
    p.structuredProperty?.urn?.includes(EVIDENCE_TIER_PROPERTY_ID),
  );
  const tier = tierProp?.values?.[0]?.stringValue ?? null;
  return { linkUrl: link, evidenceTier: tier, read: "ok", readError: null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Read the after-state until it carries what was intended, or the bound elapses.
 *
 * Returns the *final* observation together with the record of how it was
 * reached, so a receipt reports what the catalog last actually showed rather
 * than the first thing it said. A stale read is not a failure to observe — the
 * read succeeded — so `status` and the state's own `read` say different things
 * and both are kept.
 *
 * The bound governs the whole phase, not just the gaps between reads. Each poll
 * is given only the budget that remains, because an instance that accepts a
 * request and never answers would otherwise hold the loop for a full request
 * timeout — and the receipt would report an `elapsedMs` far above the bound it
 * claims to have applied. A deadline that only takes effect between reads is
 * not a deadline.
 */
async function observeUntilIntent(urn, intent, timeoutMs, intervalMs) {
  const startedAt = Date.now();
  let polls = 0;
  let state;

  for (;;) {
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    state = await readState(urn, Math.max(1, Math.min(REQUEST_TIMEOUT_MS, remainingMs)));
    polls += 1;
    const elapsedMs = Date.now() - startedAt;

    if (matchesIntent(state, intent)) {
      return { state, record: { status: "settled", polls, elapsedMs, timeoutMs, lastError: null } };
    }
    if (elapsedMs + intervalMs >= timeoutMs) {
      // A read that never completed and a read that completed showing the wrong
      // thing are different failures, and the receipt has to say which.
      return {
        state,
        record: {
          status: state.read === "ok" ? "timed-out" : "failed",
          polls,
          elapsedMs,
          timeoutMs,
          lastError: state.readError,
        },
      };
    }
    await sleep(intervalMs);
  }
}

const PROPERTY_URN = `urn:li:structuredProperty:${EVIDENCE_TIER_PROPERTY_ID}`;

/**
 * Read the deployed definition back, in the shape the reconciler compares.
 *
 * Returns `null` for every way this can fail to produce a reading — transport
 * error, absent property, absent definition — because the reconciler treats
 * "could not be read" as one condition and fails closed on it. Distinguishing
 * *why* it could not be read would suggest some of those reasons are
 * survivable, and none of them are: each leaves us equally ignorant of what a
 * written tier value would be taken to mean.
 *
 * The selection set is taken from DataHub's published GraphQL schema, and was
 * confirmed against a live quickstart at the pinned GMS `v1.5.0.6` on
 * 2026-08-05: every compared field came back populated. That check was not
 * optional. The stub in `test/integration/run-writeback.cli.test.ts` proves the
 * reconciliation logic and the fail-closed path but cannot prove the wire
 * shape, and a wrong shape here returns `null` and refuses every run — safe
 * against corruption, still a total outage. This repository has been bitten
 * once already by trusting DataHub prose over resolver source (see
 * `planWriteback`), so re-confirm against a live instance if the GMS pin moves.
 */
async function readDeployedDefinition() {
  const { ok, body } = await gql(`query($urn: String!) {
    structuredProperty(urn: $urn) {
      definition {
        displayName
        description
        cardinality
        valueType { urn }
        entityTypes { urn }
        allowedValues { value { ... on StringValue { stringValue } } description }
      }
    }
  }`, { urn: PROPERTY_URN });

  if (!ok) return null;
  const definition = body?.data?.structuredProperty?.definition;
  if (!definition) return null;

  return {
    displayName: definition.displayName ?? null,
    description: definition.description ?? null,
    cardinality: definition.cardinality ?? null,
    valueTypeUrn: definition.valueType?.urn ?? null,
    entityTypeUrns: (definition.entityTypes ?? []).map((t) => t.urn).filter(Boolean),
    allowedValues: (definition.allowedValues ?? [])
      .map((v) => ({
        stringValue: v.value?.stringValue ?? null,
        description: v.description ?? null,
      }))
      .filter((v) => v.stringValue !== null),
  };
}

/**
 * Define the structured property, then prove the catalog holds the definition
 * this tool's tier values are only meaningful under.
 *
 * The create is attempted unconditionally and `already exists` is not an
 * error — but it is not success either, which is the correction here. It used
 * to be reported as success outright, so a catalog carrying a definition that
 * disagreed with this package's lattice was indistinguishable from one that
 * agreed, and the receipt said the contract was deployed either way. A tier
 * token means nothing on its own; it means what its definition says it means.
 * Writing `VERIFIED` into a catalog that defines `VERIFIED` as something else
 * publishes a claim this tool did not make.
 *
 * So the definition is read back in both cases — after a fresh create as much
 * as after discovering an existing one, because a create that reports a URN
 * still does not establish what the server stored — and the reading, not the
 * mutation's own report, decides the outcome.
 */
async function ensureProperty() {
  const { body, error } = await gql(`mutation($input: CreateStructuredPropertyInput!) {
    createStructuredProperty(input: $input) { urn }
  }`, {
    input: {
      id: EVIDENCE_TIER_PROPERTY_ID,
      qualifiedName: EVIDENCE_TIER_PROPERTY_DEFINITION.qualifiedName,
      displayName: EVIDENCE_TIER_PROPERTY_DEFINITION.displayName,
      description: EVIDENCE_TIER_PROPERTY_DEFINITION.description,
      valueType: EVIDENCE_TIER_PROPERTY_DEFINITION.valueTypeUrn,
      cardinality: EVIDENCE_TIER_PROPERTY_DEFINITION.cardinality,
      entityTypes: [...EVIDENCE_TIER_PROPERTY_DEFINITION.entityTypeUrns],
      allowedValues: EVIDENCE_TIER_PROPERTY_DEFINITION.allowedValues.map((v) => ({
        stringValue: v.stringValue,
        description: v.description,
      })),
    },
  });

  const created = body?.data?.createStructuredProperty?.urn ?? null;
  const already = Boolean(
    JSON.stringify(body?.errors ?? "").match(/already exists|Conflict|duplicate/i),
  );
  const reconciliation = reconcileDeployedDefinition(await readDeployedDefinition());

  const origin = created ? `created ${created}` : already ? "already defined" : (error ?? JSON.stringify(body).slice(0, 200));
  return {
    reconciled: reconciliation.reconciled,
    response: reconciliation.reconciled
      ? `${origin}; deployed definition reconciled`
      : `${origin}; deployed definition NOT reconciled — ${reconciliation.problems.join("; ")}`,
  };
}

const refused = refusalReason(event);
const intent = intendedState(event);
// A dry run *chose* not to read. Recording that as a failed read would report a
// deliberate decision as a fault — the same collapse of a non-claim into a
// claim that the change-impact contract exists to prevent.
const before = DRY
  ? notQueriedState("dry run: the catalog was not read")
  : await readState(event.subject.urn);
const plan = planWriteback(event);
const attempts = [];

// Set when the deployed definition could not be reconciled, so the phases below
// can tell "nothing was applied because we refused to" apart from "nothing was
// applied because there was nothing to do".
let definitionBlocked = false;

if (!refused && !DRY) {
  const prop = await ensureProperty();
  attempts.push({
    mutation: "createStructuredProperty",
    variables: { input: { id: EVIDENCE_TIER_PROPERTY_ID } },
    succeeded: prop.reconciled,
    response: prop.response,
  });
  definitionBlocked = !prop.reconciled;

  // Fail closed, and close the whole gate rather than half of it.
  //
  // The tier value is the write that is unsafe under a divergent definition,
  // and the link carries no tier semantics, so there is an argument for
  // applying the link anyway. It is the wrong trade. Applying half the plan
  // leaves the catalog in a state no single run produced, and `intendedState`
  // covers both writes, so the observation loop would then poll to its full
  // bound waiting for a tier that was deliberately never sent — a receipt
  // reporting a timeout for a decision. Refusing both keeps the receipt's
  // account of the run true: nothing was applied, and the reason is named.
  for (const step of definitionBlocked ? [] : plan) {
    const query =
      step.mutation === "upsertLink"
        ? `mutation($input: UpsertLinkInput!) { upsertLink(input: $input) }`
        : `mutation($input: UpsertStructuredPropertiesInput!) { upsertStructuredProperties(input: $input) { properties { structuredProperty { urn } } } }`;
    const { ok, body, error } = await gql(query, step.variables);
    attempts.push({
      mutation: step.mutation,
      variables: redact(step.variables),
      succeeded: ok,
      response: (ok ? JSON.stringify(body.data) : (error ?? "unknown failure")).slice(0, 400),
    });
  }
}

// Nothing was applied, so there is nothing to observe. `after` repeats `before`
// rather than inventing a second reading nobody took.
const observed =
  DRY || refused || intent === null || definitionBlocked
    ? { state: before, record: null }
    : await observeUntilIntent(event.subject.urn, intent, OBSERVE_TIMEOUT_MS, OBSERVE_INTERVAL_MS);

const after = observed.state;

// The verdicts are derived in src/integration/writeback.ts, where they are
// testable without a live catalog. This script gathers evidence; it does not
// decide what the evidence means.
const outcome = deriveOutcome({ refusedBecause: refused, intent, before, after, attempts });

const receipt = {
  targetUrn: event.subject.urn,
  actor: { tool: "@workspacejson/datahub-agent", version: "0.0.1" },
  attemptedAt: new Date().toISOString(),
  revision: { repository: event.provenance.corpus.repository, commit: event.provenance.corpus.commit },
  intended: intent,
  before,
  after,
  attempts,
  observation: observed.record,
  ...outcome,
  refusedBecause: refused,
  linkOmittedBecause: linkOmission(event),
};

const enriched = attachReceipt(event, receipt);
const json = `${JSON.stringify(enriched, null, 2)}\n`;

// The receipt is the product. Without a destination it goes to stdout so it can
// be piped or retained; discarding it would defeat the point of emitting one.
if (OUT) {
  writeFileSync(resolve(OUT), json);
  console.error(`written to ${OUT}`);
} else {
  process.stdout.write(json);
}

const describe = (s) => {
  if (s.read === "failed") return `UNREADABLE (${s.readError})`;
  if (s.read === "not-queried") return `NOT QUERIED (${s.readError})`;
  return `link=${s.linkUrl ? "present" : "absent"} tier=${s.evidenceTier ?? "unset"}`;
};

console.error(`\ntarget       ${receipt.targetUrn}`);
console.error(`mode         ${DRY ? "dry-run" : "applied"}`);
console.error(`refused      ${refused ?? "no"}`);
console.error(`before       ${describe(before)}`);
console.error(`after        ${describe(after)}`);
for (const a of attempts) console.error(`  ${a.succeeded ? "ok  " : "FAIL"} ${a.mutation}  ${a.response.slice(0, 110)}`);
if (definitionBlocked) {
  // Truncated above, in full here: this is the one message the operator has to
  // act on, and it names each divergence with both values.
  const detail = attempts.find((a) => a.mutation === "createStructuredProperty")?.response ?? "";
  console.error(`\nNOTHING WAS APPLIED. The deployed definition of ${EVIDENCE_TIER_PROPERTY_ID}`);
  console.error(`disagrees with the evidence lattice this tool derives tiers from:\n`);
  console.error(`  ${detail}\n`);
  console.error(`Reconcile the definition in DataHub, then re-run. This tool does not rewrite a`);
  console.error(`definition it did not create.`);
}
if (observed.record) {
  const { status, polls, elapsedMs, timeoutMs } = observed.record;
  console.error(`observation  ${status} after ${polls} read(s) in ${elapsedMs}ms (bound ${timeoutMs}ms)`);
}
console.error(`succeeded    ${receipt.succeeded}   noop=${receipt.noop}   bothStatesRead=${receipt.bothStatesRead}`);

// A refusal is a legitimate outcome, not a failure. A dry run asserts nothing.
process.exit(DRY || refused || receipt.succeeded ? 0 : 1);
