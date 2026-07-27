#!/usr/bin/env node
/**
 * Field-coverage probe: what DataHub holds on a Dataset vs what the official
 * MCP server projects to an agent.
 *
 * This exists because the difference is invisible from either side alone. An
 * agent consuming MCP sees a field is absent and cannot tell whether the
 * catalog never had it or the projection dropped it. Those call for opposite
 * fixes — ingest differently, or change the projection — so the distinction is
 * the whole finding.
 *
 * Both queries run against the same GMS endpoint and the same URN. Query A asks
 * for the fields DataHub can serve. Query B mirrors the Dataset block of the
 * MCP server's `entity_details.gql` `entityPreview` fragment exactly, so the
 * comparison is like-for-like rather than a claim about MCP's behavior.
 *
 * Reproducing this needs only a running DataHub with a dbt project ingested —
 * no MCP client, no credentials beyond whatever GMS requires.
 *
 * Usage:
 *   node scripts/probe-mcp-dataset-fields.mjs [urn] [--gms http://localhost:8080]
 *
 * Exit codes:
 *   0  gap observed and reported, or dataset carries no externalUrl to drop
 *   1  the gap is CLOSED — MCP now projects every field checked here.
 *      That is good news and means this record is stale: update
 *      evaluation/mcp-field-coverage.md rather than deleting this probe.
 *   2  could not reach GMS, or the URN does not exist
 */

const args = process.argv.slice(2);
const gmsIndex = args.indexOf("--gms");
const GMS = gmsIndex === -1 ? "http://localhost:8080" : args[gmsIndex + 1];
const URN =
  args.find((a) => a.startsWith("urn:")) ??
  "urn:li:dataset:(urn:li:dataPlatform:dbt,jaffle_shop.main.customers,PROD)";

/**
 * Query B is a transcription of the MCP server's own projection, not a guess.
 * Source: acryldata/mcp-server-datahub
 *         src/mcp_server_datahub/gql/entity_details.gql
 *         fragment entityPreview on Entity -> ... on Dataset -> properties
 * If upstream changes that block, this transcription must change with it or the
 * comparison stops being honest.
 */
const MCP_PROJECTION_FIELDS = ["name", "description", "customProperties"];

/** Fields DataHub can serve on DatasetProperties that an agent plausibly wants. */
const CATALOG_FIELDS = ["name", "description", "externalUrl", "customProperties"];

function propsQuery(fields) {
  const selection = fields
    .map((f) => (f === "customProperties" ? "customProperties { key value }" : f))
    .join("\n        ");
  return `{ dataset(urn: ${JSON.stringify(URN)}) { urn properties {\n        ${selection}\n      } } }`;
}

async function gql(query) {
  let response;
  try {
    response = await fetch(`${GMS}/api/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    console.error(`\nCould not reach GMS at ${GMS} — ${error.message}`);
    console.error("Start one with: datahub docker quickstart\n");
    process.exit(2);
  }
  const body = await response.json();
  if (body.errors) {
    console.error(`\nGraphQL error: ${JSON.stringify(body.errors).slice(0, 300)}\n`);
    process.exit(2);
  }
  return body.data;
}

const catalog = await gql(propsQuery(CATALOG_FIELDS));

// DataHub returns a soft entity — non-null, with null properties — for a URN it
// has never seen. Treating that as "nothing was dropped" would report GAP
// CLOSED for a typo, which is the exact false claim this probe exists to
// prevent. Refuse to measure instead.
if (!catalog.dataset || catalog.dataset.properties == null) {
  console.error(`\nNo usable dataset at ${URN}.`);
  console.error(
    catalog.dataset
      ? "The URN resolves but carries no properties — it was never ingested.\n"
      : "The URN does not resolve at all.\n",
  );
  console.error("Ingest a dbt project first, then re-run.\n");
  process.exit(2);
}

const mcp = await gql(propsQuery(MCP_PROJECTION_FIELDS));

const held = catalog.dataset.properties ?? {};
const projected = mcp.dataset.properties ?? {};

const dropped = CATALOG_FIELDS.filter(
  (f) => held[f] != null && !MCP_PROJECTION_FIELDS.includes(f),
);

const customProperties = Object.fromEntries(
  (held.customProperties ?? []).map((c) => [c.key, c.value]),
);

console.log(`urn   ${URN}`);
console.log(`gms   ${GMS}\n`);

console.log("DataHub holds:");
for (const f of CATALOG_FIELDS) {
  if (f === "customProperties") continue;
  const v = held[f];
  console.log(`  ${f.padEnd(14)} ${v == null ? "(null)" : String(v).slice(0, 96)}`);
}

console.log("\nMCP projects to the agent:");
for (const f of MCP_PROJECTION_FIELDS) {
  if (f === "customProperties") continue;
  const v = projected[f];
  console.log(`  ${f.padEnd(14)} ${v == null ? "(null)" : String(v).slice(0, 96)}`);
}

console.log("\nReachable via customProperties (already projected):");
for (const k of ["dbt_file_path", "dbt_unique_id"]) {
  console.log(`  ${k.padEnd(14)} ${customProperties[k] ?? "(absent)"}`);
}

if (dropped.length === 0) {
  // Distinguish "the projection now carries everything" from "this dataset had
  // nothing to carry". Only the first means the gap closed; the second means
  // the fixture is wrong for this measurement.
  const hasSomethingToDrop = CATALOG_FIELDS.some(
    (f) => !MCP_PROJECTION_FIELDS.includes(f) && held[f] != null,
  );
  if (!hasSomethingToDrop) {
    console.error(
      "\nINCONCLUSIVE — this dataset carries none of the fields under test, so\n" +
        "there is nothing for the projection to drop. Use a dataset ingested with\n" +
        "git_info set, or the gap cannot be observed here.",
    );
    process.exit(2);
  }
  console.log("\nGAP CLOSED — every field DataHub holds is projected through MCP.");
  console.log("This record is stale. Update evaluation/mcp-field-coverage.md.");
  process.exit(1);
}

console.log(`\nDROPPED AT THE MCP BOUNDARY: ${dropped.join(", ")}`);
console.log(
  "\nDataHub computed these and the projection discards them. For externalUrl the\n" +
    "consequence is concrete: customProperties.dbt_file_path is relative to the dbt\n" +
    "project, so an agent holding only that must also know the repository, the\n" +
    "commit, and the project's offset from the repository root to rebuild a link.\n" +
    "externalUrl is the assembled, commit-pinned answer the server already produced.",
);
