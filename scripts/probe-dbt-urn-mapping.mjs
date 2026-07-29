#!/usr/bin/env node
/**
 * HAC-231 step-2 probe: is DataHub's dbt unique-ID -> URN mapping a documented,
 * deterministic rule over manifest.json fields?
 *
 * Direction of evidence matters here. The RULE is transcribed from DataHub's own
 * ingestion source (acryl-datahub 1.6.0.16, the pinned version that populated the
 * catalog). The INPUTS are read from the pinned dbt manifest. The catalog is used
 * ONLY as the comparison target.
 *
 * It is therefore not self-confirming: nothing about the expected URN is read out
 * of DataHub. If the catalog were wrong, this probe would disagree with it rather
 * than agree.
 *
 * Rule, from datahub/ingestion/source/dbt/dbt_core.py:251-261 and
 * dbt_common.py:1136-1157:
 *
 *   name    = manifest_node["name"]
 *           | manifest_node["identifier"]  if use_identifiers and present
 *           | manifest_node["alias"]       if alias is not None and resource_type != "test"
 *   database= manifest_node["database"]    if include_database_name else None
 *   schema  = manifest_node["schema"]
 *   db_fqn  = [database, schema, name] filtered for truthiness, joined ".", '"' stripped
 *   db_fqn  = db_fqn.lower()  if convert_urns_to_lowercase
 *   urn     = urn:li:dataset:(urn:li:dataPlatform:<platform>,<db_fqn>,<env>)
 */

import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };

const MANIFEST = flag("manifest", "/tmp/hac-152-live.5PoLx6/transfermarkt/dbt/target/manifest.json");
const GMS = flag("gms", "http://localhost:8080");
const ENV = flag("env", "PROD");
const PLATFORM = flag("platform", "dbt");

// Defaults as configured by scripts/reproduce-hac-152-live.sh, which sets neither
// of these, so the source defaults apply.
const USE_IDENTIFIERS = false;
const INCLUDE_DATABASE_NAME = true;
const CONVERT_URNS_TO_LOWERCASE = false;

const joinParts = (parts) => parts.filter(Boolean).join(".");

function dbFqn(node) {
  const name =
    USE_IDENTIFIERS && node.identifier ? node.identifier
    : node.alias != null && node.resource_type !== "test" ? node.alias
    : node.name;
  const database = INCLUDE_DATABASE_NAME ? node.database : null;
  let fqn = joinParts([database, node.schema, name]).replaceAll('"', "");
  if (CONVERT_URNS_TO_LOWERCASE) fqn = fqn.toLowerCase();
  return fqn;
}

const urnFor = (fqn) => `urn:li:dataset:(urn:li:dataPlatform:${PLATFORM},${fqn},${ENV})`;

// --- derive from the manifest (independent of the catalog) --------------------

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
console.log(`manifest:      ${MANIFEST}`);
console.log(`dbt_version:   ${manifest.metadata?.dbt_version} / ${manifest.metadata?.adapter_type}`);
console.log(`project:       ${manifest.metadata?.project_name}`);

// Only materialised models become dbt datasets. Tests/ephemeral are excluded --
// ephemeral nodes get a different name shape (get_fake_ephemeral_table_name).
const modelNodes = Object.entries(manifest.nodes ?? {}).filter(
  ([, n]) => n.resource_type === "model" && n.config?.materialized !== "ephemeral",
);
const sourceNodes = Object.entries(manifest.sources ?? {});

const derived = new Map();
for (const [uid, n] of modelNodes) derived.set(uid, urnFor(dbFqn(n)));
for (const [uid, n] of sourceNodes) derived.set(uid, urnFor(dbFqn(n)));

console.log(`model nodes:   ${modelNodes.length}`);
console.log(`source nodes:  ${sourceNodes.length}`);
console.log(`derived URNs:  ${derived.size}`);

// --- read the catalog (comparison target only) -------------------------------

const res = await fetch(`${GMS}/api/graphql`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    query: `{ search(input:{type:DATASET, query:"*", start:0, count:500}){ total searchResults { entity { urn } } } }`,
  }),
  signal: AbortSignal.timeout(30_000),
});
const body = await res.json();

// GraphQL reports failure at HTTP 200 with a top-level `errors` array, and it
// can do so *while* returning partial `data`. This probe's entire output is a
// set difference — "derived only" and "catalog only" — so a silently short
// catalog does not look like an error. It looks like the derivation inventing
// URNs the instance does not have, which is precisely the conclusion this probe
// exists to rule out. It would have reported a wrong answer confidently.
//
// Checked before the shape, because a partial response has a plausible shape.
if (!res.ok || body.errors) {
  console.error(`Catalog read failed: ${JSON.stringify(body.errors ?? { status: res.status }).slice(0, 300)}`);
  process.exit(2);
}

const results = body.data?.search?.searchResults;
if (!Array.isArray(results)) {
  console.error("Catalog read returned no searchResults array; refusing to compare against an unknown catalog.");
  process.exit(2);
}

// A truncated page is the other way this comparison goes quietly wrong: `count`
// is 500, and a catalog larger than that would silently drop the tail into
// "derived only". Stated rather than assumed.
if (typeof body.data.search.total === "number" && body.data.search.total > results.length) {
  console.error(
    `Catalog holds ${body.data.search.total} datasets but this read returned ${results.length}. ` +
    `Raise the page size; a truncated catalog turns present URNs into apparent misses.`,
  );
  process.exit(2);
}

const allUrns = results.map((r) => r.entity.urn);
const catalog = new Set(allUrns.filter((u) => u.includes(`dataPlatform:${PLATFORM},`)));

console.log(`catalog (${PLATFORM}): ${catalog.size}\n`);

// --- exact comparison --------------------------------------------------------

const derivedSet = new Set(derived.values());
const missing = [...derivedSet].filter((u) => !catalog.has(u)).sort();   // derived but absent
const extra = [...catalog].filter((u) => !derivedSet.has(u)).sort();     // present but not derived

console.log(`derived∩catalog: ${[...derivedSet].filter((u) => catalog.has(u)).length}`);
console.log(`derived only:    ${missing.length}`);
console.log(`catalog only:    ${extra.length}\n`);

if (missing.length) {
  console.log("DERIVED BUT NOT IN CATALOG:");
  for (const u of missing.slice(0, 15)) {
    const uid = [...derived.entries()].find(([, v]) => v === u)?.[0];
    console.log(`  ${u}\n    <- ${uid}`);
  }
  if (missing.length > 15) console.log(`  ... and ${missing.length - 15} more`);
}
if (extra.length) {
  console.log("\nIN CATALOG BUT NOT DERIVED:");
  for (const u of extra.slice(0, 15)) console.log(`  ${u}`);
  if (extra.length > 15) console.log(`  ... and ${extra.length - 15} more`);
}

const exact = missing.length === 0 && extra.length === 0;
console.log(`\n${"=".repeat(72)}`);
console.log(
  exact
    ? "VERDICT: rule regenerates the catalog's URN set for this platform EXACTLY. Mapping is\n         deterministic and mechanically reproducible from the manifest."
    : "VERDICT: rule does NOT reproduce the catalog set exactly. See divergence above.",
);
process.exit(exact ? 0 : 1);
