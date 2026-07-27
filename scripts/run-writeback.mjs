#!/usr/bin/env node
/**
 * Execute the OSS-safe enrichment writeback against a live DataHub and emit a
 * receipt.
 *
 * Reads before-state, plans the mutations, applies them, reads after-state, and
 * records every attempt. A receipt is produced whether or not the write
 * succeeded — a silent failure is the outcome this is built to prevent. That
 * promise is why no transport error is allowed to escape: an exception thrown
 * past the receipt would be exactly the silent failure this exists to avoid.
 *
 * The enriched event goes to stdout unless --out names a file, so the default
 * invocation can be piped or retained. Diagnostics stay on stderr.
 *
 * Usage:
 *   node scripts/run-writeback.mjs <event.json> [--gms URL] [--dry-run] [--out FILE]
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
const eventPath =
  argv.find((a) => a.endsWith(".json")) ??
  join(repoRoot, "test/fixtures/golden/change-impact-event.nested.json");

const {
  planWriteback,
  refusalReason,
  redact,
  attachReceipt,
  isNoop,
  unreadableState,
  LINK_LABEL,
  EVIDENCE_TIER_PROPERTY_ID,
} = await import(join(repoRoot, "src/integration/writeback.ts"));

const event = JSON.parse(readFileSync(resolve(eventPath), "utf8"));

/**
 * Post a GraphQL document, and never throw.
 *
 * Transport failure, a non-JSON body and a GraphQL error all come back as
 * `ok: false` with the detail preserved, so every caller reaches the receipt.
 */
async function gql(query, variables = {}) {
  try {
    const response = await fetch(`${GMS}/api/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
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
async function readState(urn) {
  const { ok, body, error } = await gql(`query($urn: String!) {
    dataset(urn: $urn) {
      institutionalMemory { elements { url label } }
      structuredProperties { properties { structuredProperty { urn } values { ... on StringValue { stringValue } } } }
    }
  }`, { urn });

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

/** A state we deliberately did not read, because a dry run changes nothing. */
const notRead = (why) => unreadableState(why);

/** Define the structured property once. Safe to repeat — an existing id is not an error we propagate. */
async function ensureProperty() {
  const { body, error } = await gql(`mutation($input: CreateStructuredPropertyInput!) {
    createStructuredProperty(input: $input) { urn }
  }`, {
    input: {
      id: EVIDENCE_TIER_PROPERTY_ID,
      qualifiedName: EVIDENCE_TIER_PROPERTY_ID,
      displayName: "Evidence tier (workspace.json)",
      description:
        "Mechanically derived from the evidence records supporting the dataset-to-code resolution. ASSERTED: no supporting record. OBSERVED: at least one record. VERIFIED: at least one record whose check was executed.",
      valueType: "urn:li:dataType:datahub.string",
      cardinality: "SINGLE",
      entityTypes: ["urn:li:entityType:datahub.dataset"],
      allowedValues: [
        { stringValue: "ASSERTED", description: "claimed, with no supporting record" },
        { stringValue: "OBSERVED", description: "at least one recorded observation" },
        { stringValue: "VERIFIED", description: "at least one check executed by the harness" },
      ],
    },
  });
  const created = body?.data?.createStructuredProperty?.urn ?? null;
  const already = JSON.stringify(body?.errors ?? "").match(/already exists|Conflict|duplicate/i);
  return {
    created,
    already: Boolean(already),
    raw: error ?? JSON.stringify(body).slice(0, 300),
  };
}

const refused = refusalReason(event);
const before = DRY
  ? notRead("dry run: the catalog was not read")
  : await readState(event.subject.urn);
const plan = planWriteback(event);
const attempts = [];

if (!refused && !DRY) {
  const prop = await ensureProperty();
  attempts.push({
    mutation: "createStructuredProperty",
    variables: { input: { id: EVIDENCE_TIER_PROPERTY_ID } },
    succeeded: Boolean(prop.created) || prop.already,
    response: prop.created ? `created ${prop.created}` : prop.already ? "already defined" : prop.raw,
  });

  for (const step of plan) {
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

const after =
  DRY || refused
    ? before
    : await readState(event.subject.urn);

const verified = before.read === "ok" && after.read === "ok";

const receipt = {
  targetUrn: event.subject.urn,
  actor: { tool: "@workspacejson/datahub-agent", version: "0.0.1" },
  attemptedAt: new Date().toISOString(),
  revision: { repository: event.provenance.corpus.repository, commit: event.provenance.corpus.commit },
  before,
  after,
  attempts,
  // A write is only claimed successful when its mutations landed AND the result
  // was observable. Mutations returning cleanly against an unreadable instance
  // is not the same as a verified write.
  succeeded:
    !refused && attempts.length > 0 && attempts.every((a) => a.succeeded) && verified,
  noop: !refused && isNoop(before, after),
  verified,
  refusedBecause: refused,
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

const describe = (s) =>
  s.read === "failed"
    ? `UNREADABLE (${s.readError})`
    : `link=${s.linkUrl ? "present" : "absent"} tier=${s.evidenceTier ?? "unset"}`;

console.error(`\ntarget       ${receipt.targetUrn}`);
console.error(`mode         ${DRY ? "dry-run" : "applied"}`);
console.error(`refused      ${refused ?? "no"}`);
console.error(`before       ${describe(before)}`);
console.error(`after        ${describe(after)}`);
for (const a of attempts) console.error(`  ${a.succeeded ? "ok  " : "FAIL"} ${a.mutation}  ${a.response.slice(0, 110)}`);
console.error(`succeeded    ${receipt.succeeded}   noop=${receipt.noop}   verified=${receipt.verified}`);

// A refusal is a legitimate outcome, not a failure. A dry run asserts nothing.
process.exit(DRY || refused || receipt.succeeded ? 0 : 1);
