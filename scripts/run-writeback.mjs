#!/usr/bin/env node
/**
 * Execute the OSS-safe enrichment writeback against a live DataHub and emit a
 * receipt.
 *
 * Reads before-state, plans the mutations, applies them, reads after-state, and
 * records every attempt. A receipt is produced whether or not the write
 * succeeded — a silent failure is the outcome this is built to prevent.
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

const { planWriteback, refusalReason, redact, attachReceipt, LINK_LABEL, EVIDENCE_TIER_PROPERTY_ID } =
  await import(join(repoRoot, "src/integration/writeback.ts"));

const event = JSON.parse(readFileSync(resolve(eventPath), "utf8"));

async function gql(query, variables = {}) {
  const response = await fetch(`${GMS}/api/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  return { ok: !body.errors, body };
}

/** Read the state this writeback would change. */
async function readState(urn) {
  const { body } = await gql(`query($urn: String!) {
    dataset(urn: $urn) {
      institutionalMemory { elements { url label } }
      structuredProperties { properties { structuredProperty { urn } values { ... on StringValue { stringValue } } } }
    }
  }`, { urn });
  const ds = body?.data?.dataset;
  const link =
    (ds?.institutionalMemory?.elements ?? []).find((e) => e.label === LINK_LABEL)?.url ?? null;
  const tierProp = (ds?.structuredProperties?.properties ?? []).find((p) =>
    p.structuredProperty?.urn?.includes(EVIDENCE_TIER_PROPERTY_ID),
  );
  const tier = tierProp?.values?.[0]?.stringValue ?? null;
  return { linkUrl: link, evidenceTier: tier };
}

/** Define the structured property once. Safe to repeat — an existing id is not an error we propagate. */
async function ensureProperty() {
  const { body } = await gql(`mutation($input: CreateStructuredPropertyInput!) {
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
  return { created, already: Boolean(already), raw: JSON.stringify(body).slice(0, 300) };
}

const refused = refusalReason(event);
const before = DRY ? { linkUrl: null, evidenceTier: null } : await readState(event.subject.urn);
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
    const { ok, body } = await gql(query, step.variables);
    attempts.push({
      mutation: step.mutation,
      variables: redact(step.variables),
      succeeded: ok,
      response: JSON.stringify(ok ? body.data : body.errors).slice(0, 400),
    });
  }
}

const after = DRY || refused ? before : await readState(event.subject.urn);

const receipt = {
  targetUrn: event.subject.urn,
  actor: { tool: "@workspacejson/datahub-agent", version: "0.0.1" },
  attemptedAt: new Date().toISOString(),
  revision: { repository: event.provenance.corpus.repository, commit: event.provenance.corpus.commit },
  before,
  after,
  attempts,
  succeeded: !refused && attempts.length > 0 && attempts.every((a) => a.succeeded),
  noop:
    !refused &&
    before.linkUrl === after.linkUrl &&
    before.evidenceTier === after.evidenceTier &&
    before.linkUrl !== null,
  refusedBecause: refused,
};

const enriched = attachReceipt(event, receipt);
const json = `${JSON.stringify(enriched, null, 2)}\n`;
if (OUT) {
  writeFileSync(resolve(OUT), json);
  console.log(`written to ${OUT}`);
}

console.error(`\ntarget       ${receipt.targetUrn}`);
console.error(`mode         ${DRY ? "dry-run" : "applied"}`);
console.error(`refused      ${refused ?? "no"}`);
console.error(`before       link=${before.linkUrl ? "present" : "absent"} tier=${before.evidenceTier ?? "unset"}`);
console.error(`after        link=${after.linkUrl ? "present" : "absent"} tier=${after.evidenceTier ?? "unset"}`);
for (const a of attempts) console.error(`  ${a.succeeded ? "ok  " : "FAIL"} ${a.mutation}  ${a.response.slice(0, 110)}`);
console.error(`succeeded    ${receipt.succeeded}   noop=${receipt.noop}`);
process.exit(receipt.succeeded || DRY || refused ? 0 : 1);
