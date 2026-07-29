#!/usr/bin/env node
/**
 * HAC-231 edge-case probe: 5 checks against the live DataHub instance while it
 * is available, all relevant to the kill-switch decision.
 */

const GMS = "http://localhost:8080";

const ROOT_URN = "urn:li:dataset:(urn:li:dataPlatform:dbt,jaffle_shop.main.customers,PROD)";
const NESTED_URN = "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)";

async function gql(query) {
  const response = await fetch(`${GMS}/api/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 300));
  return body.data;
}

function separator(n) {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`CHECK ${n}`);
  console.log(`${"=".repeat(72)}`);
}

// ---------------------------------------------------------------------------
// 1. Two consecutive reads — is the root corpus index stable right now?
// ---------------------------------------------------------------------------
separator(1);
console.log("Two consecutive searchAcrossLineage reads (root UPSTREAM)");
console.log("Readiness requires two consecutive set-equal reads.\n");

const read1Raw = await gql(`{
  searchAcrossLineage(input: { urn: ${JSON.stringify(ROOT_URN)}, direction: UPSTREAM, query: "*", start: 0, count: 50 }) {
    total searchResults { degree entity { urn } }
  }
}`);
const read2Raw = await gql(`{
  searchAcrossLineage(input: { urn: ${JSON.stringify(ROOT_URN)}, direction: UPSTREAM, query: "*", start: 0, count: 50 }) {
    total searchResults { degree entity { urn } }
  }
}`);

const urns1 = read1Raw.searchAcrossLineage.searchResults.map((r) => r.entity.urn).sort();
const urns2 = read2Raw.searchAcrossLineage.searchResults.map((r) => r.entity.urn).sort();
const stable = JSON.stringify(urns1) === JSON.stringify(urns2);
console.log(`  Read 1: ${urns1.length} URNs, total=${read1Raw.searchAcrossLineage.total}`);
console.log(`  Read 2: ${urns2.length} URNs, total=${read2Raw.searchAcrossLineage.total}`);
console.log(`  Sets identical: ${stable}`);
if (!stable) {
  const only1 = urns1.filter((u) => !urns2.includes(u));
  const only2 = urns2.filter((u) => !urns1.includes(u));
  if (only1.length) console.log(`  Only in read 1: ${only1}`);
  if (only2.length) console.log(`  Only in read 2: ${only2}`);
}

// ---------------------------------------------------------------------------
// 2. Duplicate URNs across degrees — set vs multiset
// ---------------------------------------------------------------------------
separator(2);
console.log("Duplicate URNs across degrees (root UPSTREAM)");
console.log("If a URN appears at multiple degrees, the set collapses them.\n");

const degreeMap = new Map();
for (const r of read1Raw.searchAcrossLineage.searchResults) {
  const urn = r.entity.urn;
  const deg = r.degree ?? "unknown";
  if (!degreeMap.has(urn)) degreeMap.set(urn, []);
  degreeMap.get(urn).push(deg);
}
const dupes = [...degreeMap.entries()].filter(([, degs]) => degs.length > 1);
console.log(`  Unique URNs: ${degreeMap.size}`);
console.log(`  Total edges: ${read1Raw.searchAcrossLineage.searchResults.length}`);
console.log(`  URNs appearing at multiple degrees: ${dupes.length}`);
for (const [urn, degs] of dupes) {
  console.log(`    ${urn} → degrees ${degs.join(", ")}`);
}
if (dupes.length === 0) console.log("  No duplicates — set and multiset are identical.");

// ---------------------------------------------------------------------------
// 3. `total` field vs returned count — are we truncating?
// ---------------------------------------------------------------------------
separator(3);
console.log("`total` field vs returned count (truncation check)");
console.log("If total > count, the result is silently truncated.\n");

for (const [label, urn] of [["root", ROOT_URN], ["nested", NESTED_URN]]) {
  for (const dir of ["UPSTREAM", "DOWNSTREAM"]) {
    const data = await gql(`{
      searchAcrossLineage(input: { urn: ${JSON.stringify(urn)}, direction: ${dir}, query: "*", start: 0, count: 50 }) {
        total searchResults { entity { urn } }
      }
    }`);
    const total = data.searchAcrossLineage.total;
    const returned = data.searchAcrossLineage.searchResults.length;
    const truncated = total > returned;
    console.log(`  ${label} ${dir}: total=${total}, returned=${returned}${truncated ? "  *** TRUNCATED ***" : ""}`);
  }
}

// ---------------------------------------------------------------------------
// 4. Dataset.relationships surface — divergence alarm baseline
// ---------------------------------------------------------------------------
separator(4);
console.log("Dataset.relationships vs searchAcrossLineage (root UPSTREAM)");
console.log("Issue says relationships is graph-index-backed like searchAcrossLineage,");
console.log("so it is correlated evidence and proves nothing about completeness.\n");

const relData = await gql(`{
  dataset(urn: ${JSON.stringify(ROOT_URN)}) {
    relationships(input: { start: 0, count: 50, direction: UPSTREAM }) {
      total
      relationships { entity { urn } type }
    }
  }
}`).catch((e) => ({ error: e.message }));

if (relData.error) {
  console.log(`  Dataset.relationships query failed: ${relData.error}`);
} else {
  const rels = relData.dataset?.relationships?.relationships ?? [];
  const relUrns = rels.map((r) => r.entity.urn).sort();
  const searchUrns = urns1;
  const onlyRel = relUrns.filter((u) => !searchUrns.includes(u));
  const onlySearch = searchUrns.filter((u) => !relUrns.includes(u));
  console.log(`  searchAcrossLineage: ${searchUrns.length} URNs`);
  console.log(`  relationships:        ${relUrns.length} URNs (total=${relData.dataset?.relationships?.total ?? "?"})`);
  if (onlyRel.length) console.log(`  ONLY in relationships: ${onlyRel}`);
  if (onlySearch.length) console.log(`  ONLY in searchAcrossLineage: ${onlySearch}`);
  if (!onlyRel.length && !onlySearch.length) console.log("  SETS MATCH — correlated, as expected.");
}

// ---------------------------------------------------------------------------
// 5. Nested corpus existence — is the Transfermarkt dataset even ingested?
// ---------------------------------------------------------------------------
separator(5);
console.log("Nested corpus existence check (Transfermarkt game_events)");
console.log("0 edges returned — is the dataset ingested at all?\n");

const nestedEntity = await gql(`{
  dataset(urn: ${JSON.stringify(NESTED_URN)}) {
    urn
    platform { name }
    properties { name }
    schemaMetadata { fields { fieldPath } }
  }
}`).catch((e) => ({ error: e.message }));

if (nestedEntity.error) {
  console.log(`  Entity query failed: ${nestedEntity.error}`);
} else {
  const ds = nestedEntity.dataset;
  if (!ds) {
    console.log("  Dataset does NOT resolve — never ingested or deleted.");
  } else {
    console.log(`  urn:        ${ds.urn}`);
    console.log(`  platform:   ${ds.platform?.name ?? "(null)"}`);
    console.log(`  name:       ${ds.properties?.name ?? "(null)"}`);
    console.log(`  schema:     ${ds.schemaMetadata?.fields?.length ?? 0} fields`);
    console.log(`  status:     ${ds.schemaMetadata?.fields?.length > 0 ? "INGESTED (schema present) — 0 edges is index lag" : "INGESTED but no schema"}`);
  }
}

console.log(`\n${"=".repeat(72)}`);
console.log("All 5 checks complete.");
