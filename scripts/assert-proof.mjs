#!/usr/bin/env node
/**
 * The assertions behind `scripts/clean-quickstart-proof.sh`.
 *
 * These read the emitted JSON artifacts. They deliberately do not read the
 * shell transcript, because a proof that greps its own human-readable output is
 * checking the formatter, not the fact. `succeeded    true` in a `tail` is a
 * line of text; `receipt.succeeded === true` in the artifact the cockpit
 * consumes is the claim.
 *
 * Every expectation is a named constant below rather than a literal buried in a
 * check, so a reviewer can see what the proof commits to before reading how it
 * is verified — and so a corpus change produces one obvious edit rather than a
 * scatter of magic numbers.
 *
 * Exit 0 only when every assertion holds. Any failure prints all failures, not
 * just the first: someone fixing one should see the other three in the same run.
 *
 * Usage:
 *   node scripts/assert-proof.mjs --run-dir DIR --urn URN
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};
const RUN_DIR = flag("run-dir");
const URN = flag("urn");
if (!RUN_DIR || !URN) {
  console.error("usage: node scripts/assert-proof.mjs --run-dir DIR --urn URN");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// What this proof commits to.
//
// Corpus-specific and stated here rather than derived from the run, because a
// proof that takes its expectations from its own output asserts only that the
// run was self-consistent.
// ---------------------------------------------------------------------------
const EXPECTED = {
  eventVersion: "1.3",
  upstreamEdges: 12,
  downstreamEdges: 1,
  schemaFieldCount: 7,
  /** Null under both transports. Neither requests `externalUrl`. */
  sourceUrl: null,
  resolutionMethod: "manifest-join",
  repositoryRelativePath: "models/customers.sql",
  /** Every lineage read here is search-backed with no pinned expectation. */
  completeness: "not-established",
  /**
   * Populated over MCP, null over direct GraphQL: the direct query reads
   * `properties.name` through a `... on Dataset` fragment and these carry their
   * name at the top level. Asserted as a count so a change in the corpus's
   * sibling shape fails loudly rather than silently widening the gap.
   *
   * Six upstream and one downstream. The first write-up of this proof said six,
   * because it counted the upstream direction and not both — and the assertion
   * caught it on the first run that checked rather than described. Kept as a
   * single total, with the split stated here, so the number cannot be right for
   * one direction and quietly wrong overall.
   */
  edgeNamesOnlyOnMcp: 7,
};

const failures = [];
const checks = [];

function check(label, ok, detail) {
  checks.push({ label, ok });
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

function eq(label, actual, expected) {
  check(label, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function load(name) {
  const path = resolve(RUN_DIR, name);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    failures.push(`could not read ${name}: ${error.message}`);
    return null;
  }
}

const mcpEvent = load("proof-event-mcp.json");
const gmsEvent = load("proof-event-gms.json");
const enriched = load("proof-enriched.json");
const enrichedRepeat = load("proof-enriched-2.json");
const reset = load("proof-reset.json");
const resetRepeat = load("proof-reset-2.json");

if (failures.length) {
  console.error("PROOF FAILED — artifacts missing:");
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Both emits produced a valid 1.3 event for the requested subject
// ---------------------------------------------------------------------------
for (const [name, event] of [["mcp", mcpEvent], ["gms", gmsEvent]]) {
  eq(`${name}: eventVersion`, event.eventVersion, EXPECTED.eventVersion);
  eq(`${name}: subject urn`, event.subject.urn, URN);
  eq(`${name}: upstream edge count`, event.datahub.upstreams.length, EXPECTED.upstreamEdges);
  eq(`${name}: downstream edge count`, event.datahub.downstreams.length, EXPECTED.downstreamEdges);
  eq(`${name}: schemaFieldCount`, event.datahub.schemaFieldCount, EXPECTED.schemaFieldCount);
  eq(`${name}: code.sourceUrl`, event.code.sourceUrl, EXPECTED.sourceUrl);
  eq(`${name}: code.method`, event.code.method, EXPECTED.resolutionMethod);
  eq(`${name}: code.repositoryRelativePath`, event.code.repositoryRelativePath, EXPECTED.repositoryRelativePath);

  // The observed count and the carried edges must agree. The contract's own
  // validator enforces this; asserting it here means a proof that silently
  // stopped validating still fails.
  for (const direction of ["upstreams", "downstreams"]) {
    const observation = event.datahub.lineageObservation[direction];
    eq(`${name}: ${direction} read`, observation.read, "ok");
    eq(`${name}: ${direction} completeness`, observation.completeness, EXPECTED.completeness);
    eq(
      `${name}: ${direction} observedCount matches carried edges`,
      observation.observedCount,
      event.datahub[direction].length,
    );
  }
}

// The events must be *new*. A failed emit leaving a previous run's artifact in
// place would otherwise pass every assertion above.
const runStartedAt = process.env.PROOF_STARTED_AT;
if (runStartedAt) {
  for (const [name, event] of [["mcp", mcpEvent], ["gms", gmsEvent]]) {
    check(
      `${name}: event produced during this run`,
      Date.parse(event.provenance.producedAt) >= Date.parse(runStartedAt),
      `producedAt ${event.provenance.producedAt} predates run start ${runStartedAt}`,
    );
  }
}

// ---------------------------------------------------------------------------
// The two transports agree where they must, and differ only where stated
// ---------------------------------------------------------------------------
const urns = (event, key) => event.datahub[key].map((edge) => edge.urn).sort();
check(
  "transports: upstream URN sets identical",
  JSON.stringify(urns(mcpEvent, "upstreams")) === JSON.stringify(urns(gmsEvent, "upstreams")),
);
check(
  "transports: downstream URN sets identical",
  JSON.stringify(urns(mcpEvent, "downstreams")) === JSON.stringify(urns(gmsEvent, "downstreams")),
);
eq("transports: schemaFieldCount identical", mcpEvent.datahub.schemaFieldCount, gmsEvent.datahub.schemaFieldCount);
eq("transports: sourceUrl identical", mcpEvent.code.sourceUrl, gmsEvent.code.sourceUrl);

// gmsVersion is the first stated difference: no MCP tool reports it.
eq("transports: gmsVersion null over MCP", mcpEvent.provenance.datahub.gmsVersion, null);
check(
  "transports: gmsVersion present over direct GraphQL",
  typeof gmsEvent.provenance.datahub.gmsVersion === "string" && gmsEvent.provenance.datahub.gmsVersion.length > 0,
  `got ${JSON.stringify(gmsEvent.provenance.datahub.gmsVersion)}`,
);
check(
  "transports: MCP states gmsVersion as not-exposed-by-source",
  mcpEvent.unavailable.some(
    (u) => u.field === "provenance.datahub.gmsVersion" && u.reason === "not-exposed-by-source",
  ),
);

// Edge names are the second stated difference, and the direction matters: MCP
// must be the side that carries more. A regression that lost them would leave
// the counts equal and pass a mere "they differ" check.
const byUrn = (event, key) => new Map(event.datahub[key].map((edge) => [edge.urn, edge]));
let onlyOnMcp = 0;
let onlyOnGms = 0;
for (const key of ["upstreams", "downstreams"]) {
  const gms = byUrn(gmsEvent, key);
  for (const edge of mcpEvent.datahub[key]) {
    const other = gms.get(edge.urn);
    if (!other) continue;
    if (edge.name !== null && other.name === null) onlyOnMcp += 1;
    if (edge.name === null && other.name !== null) onlyOnGms += 1;
  }
}
eq("transports: edge names carried only by MCP", onlyOnMcp, EXPECTED.edgeNamesOnlyOnMcp);
eq("transports: edge names carried only by direct GraphQL", onlyOnGms, 0);

// ---------------------------------------------------------------------------
// The writeback, from a catalog that held none of this tool's metadata
// ---------------------------------------------------------------------------
const receipt = enriched.writeback;
eq("writeback: enriched event version", enriched.eventVersion, EXPECTED.eventVersion);
eq("writeback: target urn", receipt.targetUrn, URN);
eq("writeback: succeeded", receipt.succeeded, true);
eq("writeback: noop", receipt.noop, false);
eq("writeback: bothStatesRead", receipt.bothStatesRead, true);
eq("writeback: refusedBecause", receipt.refusedBecause, null);
check(
  "writeback: linkOmittedBecause states a reason",
  typeof receipt.linkOmittedBecause === "string" && receipt.linkOmittedBecause.length > 0,
  `got ${JSON.stringify(receipt.linkOmittedBecause)}`,
);
eq("writeback: before state was read", receipt.before.read, "ok");
eq("writeback: before held no evidence tier", receipt.before.evidenceTier, null);
eq("writeback: before held no link", receipt.before.linkUrl, null);
eq("writeback: after carries the intended tier", receipt.after.evidenceTier, mcpEvent.evidence.tier);
eq("writeback: observation settled", receipt.observation.status, "settled");
check("writeback: every mutation succeeded", receipt.attempts.every((a) => a.succeeded));
check(
  "writeback: the structured property was created, not pre-existing",
  receipt.attempts.some((a) => a.mutation === "createStructuredProperty" && /created/i.test(a.response)),
  "the catalog already carried the property, so this run did not start clean",
);

// ---------------------------------------------------------------------------
// The repeat is a noop, which is what idempotency looks like
// ---------------------------------------------------------------------------
const repeat = enrichedRepeat.writeback;
eq("writeback repeat: succeeded", repeat.succeeded, true);
eq("writeback repeat: noop", repeat.noop, true);
eq("writeback repeat: bothStatesRead", repeat.bothStatesRead, true);

// ---------------------------------------------------------------------------
// The reset removes only what this tool owns, and proves it gone
// ---------------------------------------------------------------------------
eq("reset: disposition", reset.disposition, "cleared");
eq("reset: target urn", reset.targetUrn, URN);
eq("reset: before held the tier this run wrote", reset.before.evidenceTier, mcpEvent.evidence.tier);
eq("reset: after holds no tier", reset.after.evidenceTier, null);
eq("reset: after holds no link", reset.after.linkUrl, null);
eq("reset: after state was read", reset.after.read, "ok");
check("reset: every mutation succeeded", reset.attempts.every((a) => a.succeeded));

// The ownership boundary, asserted against the receipt rather than the source.
eq("reset: owns the writeback's link label", reset.owns.linkLabel, "Producing source (workspace.json)");
eq("reset: owns the writeback's property id", reset.owns.structuredPropertyId, "workspacejson_evidence_tier");
const resetPlan = JSON.stringify(reset.attempts.map((a) => a.variables));
for (const forbidden of ["description", "editableProperties", "tags", "glossaryTerms", "ownership", "domain"]) {
  check(`reset: issued no mutation naming ${forbidden}`, !resetPlan.includes(forbidden));
}

// ---------------------------------------------------------------------------
// The repeat reset is already-clean, which is a different fact from cleared
// ---------------------------------------------------------------------------
eq("reset repeat: disposition", resetRepeat.disposition, "already-clean");
eq("reset repeat: issued no mutations", resetRepeat.attempts.length, 0);

// ---------------------------------------------------------------------------
// Limits this proof does not overstate
// ---------------------------------------------------------------------------
// Asserted rather than merely documented: if a future change made the writeback
// claim completeness, or demonstrated `timed-out` live, the document beside this
// would be wrong and nothing else would notice.
for (const [name, event] of [["mcp", mcpEvent], ["gms", gmsEvent]]) {
  check(
    `${name}: claims no pinned-manifest completeness`,
    !JSON.stringify(event.datahub.lineageObservation).includes("complete-against-pinned-manifest"),
  );
}
eq("limits: observation was settled, not timed-out", receipt.observation.status, "settled");

// ---------------------------------------------------------------------------
const passed = checks.filter((c) => c.ok).length;
if (failures.length) {
  console.error(`\nPROOF FAILED — ${failures.length} of ${checks.length} assertions did not hold:\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`PROOF ASSERTIONS PASSED — ${passed}/${checks.length}`);
