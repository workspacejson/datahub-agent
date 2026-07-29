#!/usr/bin/env node
/**
 * HAC-231 spike: prove hop semantics are reproducible before committing to the
 * manifest derivation.
 *
 * The kill-switch trigger in HAC-231 is: "if the query's hop semantics cannot be
 * reproduced mechanically, stop." This script is the first half-hour — it queries
 * both surfaces (GraphQL searchAcrossLineage and MCP get_lineage) for the two
 * golden-fixture subject URNs, records the degree distribution per URN, and
 * compares the sets. If the two surfaces agree on set membership despite MCP's
 * 3+ degree bucketing, the hop semantics are reproducible and the derivation can
 * proceed. If they disagree, the kill switch fires.
 *
 * Two concrete signals this checks:
 *
 *   1. degrees 1–4 vs MCP's 3+ bucketing — GraphQL returns distinct degrees
 *      1, 2, 3, 4. MCP's max_hops: 3 maps to ["1", "2", "3+"], collapsing
 *      degree 4 into "3+". The URN *set* should still match if 3+ covers both
 *      3 and 4, but the degree *labels* will differ.
 *
 *   2. 6 dbt nodes vs 6 duckdb siblings among the 12 edges — the root corpus
 *      has 12 upstream edges split evenly across dbt and duckdb platforms.
 *      The dbt nodes appear at degrees 2–4, the duckdb nodes at degrees 1–3.
 *      This cross-platform duplication is a property of the lineage graph, not
 *      the dbt manifest, and the spike records whether both surfaces see it
 *      identically.
 *
 * Usage:
 *   node scripts/spike-hop-semantics.mjs [--gms http://localhost:8080]
 *     [--mcp-command mcp-server-datahub] [--transport gms|mcp|both]
 *     [urn ...]
 *
 * Defaults to both golden-fixture URNs if none are supplied.
 *
 * Exit codes:
 *   0  sets match between surfaces (or single-surface mode completed)
 *   1  sets differ — kill switch condition, hop semantics not reproducible
 *   3  inconclusive — a surface produced nothing, so a comparison this gate
 *      exists to make did not happen. Distinct from 1: a mismatch is a finding,
 *      an inconclusive run is the absence of one.
 *   2  could not reach GMS or MCP server
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const GMS = flag("gms", "http://localhost:8080");
const MCP_COMMAND = flag("mcp-command", "mcp-server-datahub");
const TRANSPORT = flag("transport", "both");
if (!["gms", "mcp", "both"].includes(TRANSPORT)) {
  console.error(`--transport must be gms, mcp, or both; got ${JSON.stringify(TRANSPORT)}`);
  process.exit(2);
}

const DEFAULT_URNS = [
  "urn:li:dataset:(urn:li:dataPlatform:dbt,jaffle_shop.main.customers,PROD)",
  "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)",
];
const URNS = argv.filter((a) => a.startsWith("urn:"));
const urns = URNS.length > 0 ? URNS : DEFAULT_URNS;

const DIRECTIONS = ["UPSTREAM", "DOWNSTREAM"];

// ---------------------------------------------------------------------------
// GraphQL surface: searchAcrossLineage with no degree filter
// ---------------------------------------------------------------------------

async function gqlSearchLineage(urn, direction) {
  const query = `{
    searchAcrossLineage(input: {
      urn: ${JSON.stringify(urn)}, direction: ${direction},
      query: "*", start: 0, count: 50
    }) {
      total
      searchResults { degree entity { urn ... on Dataset { platform { name } properties { name } } } }
    }
  }`;
  const response = await fetch(`${GMS}/api/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok || body.errors) {
    throw new Error(`GraphQL searchAcrossLineage failed: ${JSON.stringify(body.errors ?? body).slice(0, 200)}`);
  }
  const results = body.data?.searchAcrossLineage?.searchResults ?? [];
  return results.map((r) => ({
    urn: r.entity.urn,
    degree: r.degree ?? null,
    platform: r.entity?.platform?.name ?? null,
    name: r.entity?.properties?.name ?? null,
  }));
}

async function gqlVersion() {
  try {
    const response = await fetch(`${GMS}/api/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ appConfig { appVersion } }" }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    return body.data?.appConfig?.appVersion ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// MCP surface: get_lineage with max_hops: 3
// ---------------------------------------------------------------------------

async function mcpLineage(urn, direction) {
  const { McpClient } = await import(join(repoRoot, "src/integration/mcp-transport.ts")).catch(async () => {
    const api = await import("tsx/esm/api");
    api.register();
    return import(join(repoRoot, "src/integration/mcp-transport.ts"));
  });
  const mcpRead = await import(join(repoRoot, "src/integration/mcp-read.ts")).catch(async () => {
    const api = await import("tsx/esm/api");
    api.register();
    return import(join(repoRoot, "src/integration/mcp-read.ts"));
  });

  const client = new McpClient(
    {
      command: MCP_COMMAND,
      args: ["--transport", "stdio"],
      env: {
        DATAHUB_GMS_URL: GMS,
        DATAHUB_TELEMETRY_ENABLED: "false",
      },
    },
    { requestTimeoutMs: 90_000 },
  );

  try {
    await client.start();
    const call = (name, args) => client.callTool(name, args);
    const read = await mcpRead.readLineage(call, urn, direction === "UPSTREAM");
    if (read.read !== "ok") {
      throw new Error(read.error ?? "MCP get_lineage failed");
    }
    return read.edges.map((e) => ({
      urn: e.urn,
      degree: e.degree,
      platform: null,
      name: e.name,
    }));
  } finally {
    await client.stop();
  }
}

// ---------------------------------------------------------------------------
// Comparison and reporting
// ---------------------------------------------------------------------------

function groupByDegree(edges) {
  const groups = new Map();
  for (const e of edges) {
    const d = e.degree ?? "unknown";
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(e);
  }
  return groups;
}

function platformOf(urn) {
  const m = urn.match(/dataPlatform:(\w+)/);
  return m ? m[1] : null;
}

function compareSets(gqlEdges, mcpEdges) {
  const gqlUrns = new Set(gqlEdges.map((e) => e.urn));
  const mcpUrns = new Set(mcpEdges.map((e) => e.urn));
  const onlyGql = [...gqlUrns].filter((u) => !mcpUrns.has(u)).sort();
  const onlyMcp = [...mcpUrns].filter((u) => !gqlUrns.has(u)).sort();
  const both = [...gqlUrns].filter((u) => mcpUrns.has(u)).sort();
  return { onlyGql, onlyMcp, both, gqlCount: gqlUrns.size, mcpCount: mcpUrns.size };
}

function printDegreeTable(label, edges) {
  const byDegree = groupByDegree(edges);
  const degrees = [...byDegree.keys()].sort((a, b) => {
    if (a === "unknown") return 1;
    if (b === "unknown") return -1;
    return a - b;
  });
  console.log(`\n  ${label} (${edges.length} edges):`);
  for (const d of degrees) {
    const group = byDegree.get(d);
    const platforms = {};
    for (const e of group) {
      const p = e.platform ?? platformOf(e.urn) ?? "?";
      platforms[p] = (platforms[p] ?? 0) + 1;
    }
    const platStr = Object.entries(platforms).map(([k, v]) => `${k}:${v}`).join(", ");
    console.log(`    degree ${d}: ${group.length} edges  [${platStr}]`);
    for (const e of group) {
      const p = e.platform ?? platformOf(e.urn) ?? "?";
      console.log(`      ${p.padEnd(8)} ${e.urn}`);
    }
  }
}

function printComparison(gqlEdges, mcpEdges) {
  const cmp = compareSets(gqlEdges, mcpEdges);
  console.log(`\n  set comparison:`);
  console.log(`    GraphQL:  ${cmp.gqlCount} URNs`);
  console.log(`    MCP:      ${cmp.mcpCount} URNs`);
  console.log(`    both:     ${cmp.both.length} URNs`);
  if (cmp.onlyGql.length > 0) {
    console.log(`    ONLY in GraphQL:`);
    for (const u of cmp.onlyGql) console.log(`      ${u}`);
  }
  if (cmp.onlyMcp.length > 0) {
    console.log(`    ONLY in MCP:`);
    for (const u of cmp.onlyMcp) console.log(`      ${u}`);
  }
  if (cmp.onlyGql.length === 0 && cmp.onlyMcp.length === 0) {
    console.log(`    SETS MATCH`);
  }
  return cmp;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const gmsVersion = TRANSPORT !== "mcp" ? await gqlVersion() : null;
const timestamp = new Date().toISOString();

console.log("=== HAC-231 spike: hop semantics reproducibility ===");
console.log(`timestamp:    ${timestamp}`);
console.log(`gms:          ${GMS}`);
if (gmsVersion) console.log(`gms version:  ${gmsVersion}`);
console.log(`transport:    ${TRANSPORT}`);
if (TRANSPORT !== "gms") console.log(`mcp command:  ${MCP_COMMAND}`);
console.log(`urns:         ${urns.length}`);

let allMatch = true;
/**
 * Comparisons that were intended and did not happen, because a surface produced
 * nothing.
 *
 * Without this the gate passed on a comparison it never made. `allMatch` starts
 * true and only flips when *both* surfaces answered and disagreed, so an MCP
 * side that failed to start skipped the comparison entirely and left the verdict
 * reading "sets match — derivation can proceed". Observed 2026-07-29: four
 * consecutive `spawn mcp-server-datahub ENOENT` failures, and the script still
 * reported a match and exited 0.
 *
 * That is the precise failure `evaluation/lineage-readiness-signals.md` names —
 * "a readiness gate that silently always passes is strictly worse than no gate,
 * because it converts an unchecked read into an apparently-checked one" — in the
 * gate that licensed HAC-231's derivation. The recorded HAC-231 run was genuine
 * and carries real MCP counts, so its conclusion stands; this is about every
 * re-run after it, including the clean rebuild HAC-248 requires.
 */
const skipped = [];

for (const urn of urns) {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`subject: ${urn}`);

  for (const direction of DIRECTIONS) {
    console.log(`\n--- ${direction} ---`);

    let gqlEdges = null;
    let mcpEdges = null;

    if (TRANSPORT !== "mcp") {
      try {
        gqlEdges = await gqlSearchLineage(urn, direction);
      } catch (e) {
        console.error(`  GraphQL searchAcrossLineage failed: ${e.message}`);
        if (e.message.includes("fetch")) process.exit(2);
      }
    }

    if (TRANSPORT !== "gms") {
      try {
        mcpEdges = await mcpLineage(urn, direction);
      } catch (e) {
        console.error(`  MCP get_lineage failed: ${e.message}`);
        if (TRANSPORT === "mcp") process.exit(2);
      }
    }

    if (gqlEdges) {
      printDegreeTable("GraphQL searchAcrossLineage (no degree filter)", gqlEdges);
    }
    if (mcpEdges) {
      printDegreeTable("MCP get_lineage (max_hops=3)", mcpEdges);
    }

    if (gqlEdges && mcpEdges) {
      const cmp = printComparison(gqlEdges, mcpEdges);
      if (cmp.onlyGql.length > 0 || cmp.onlyMcp.length > 0) {
        allMatch = false;
      }
    } else if (TRANSPORT === "both") {
      // A comparison that could not be made is not a comparison that succeeded.
      const absent = !gqlEdges && !mcpEdges ? "neither surface" : !gqlEdges ? "GraphQL" : "MCP";
      skipped.push(`${direction} ${urn} — no answer from ${absent}`);
      console.error(`  NOT COMPARED: ${absent} produced no result for ${direction}.`);
    }
  }
}

console.log(`\n${"=".repeat(72)}`);
if (TRANSPORT === "both") {
  if (skipped.length > 0) {
    // Reported before match/differ, because it outranks both: neither verdict is
    // available when a surface did not answer.
    console.log("VERDICT: INCONCLUSIVE — a comparison this gate exists to make did not happen.");
    console.log(`${skipped.length} comparison(s) were not made:`);
    for (const entry of skipped) console.log(`  - ${entry}`);
    console.log("\nThis is not a match and not a mismatch. The gate fails toward not-ready,");
    console.log("because a surface that produced nothing cannot agree with anything.");
  } else if (allMatch) {
    console.log("VERDICT: sets match between GraphQL and MCP surfaces.");
    console.log("Hop semantics are reproducible — derivation can proceed.");
  } else {
    console.log("VERDICT: sets DIFFER between GraphQL and MCP surfaces.");
    console.log("Kill switch condition — hop semantics not reproducible.");
  }
} else {
  console.log(`VERDICT: ${TRANSPORT} surface queried. Run with --transport both to compare.`);
}

console.log(`\nquery parameters recorded:`);
console.log(`  GraphQL:  { surface: "searchAcrossLineage", query: "*", start: 0, count: 50 }`);
console.log(`  MCP:      { surface: "mcp:get_lineage", max_hops: 3, max_results: 50, query: "*" }`);
console.log(`  note:     MCP max_hops=3 maps to degree filter ["1","2","3+"] — degree 4 collapses into "3+"`);

// 3 is distinct from 1 on purpose: a mismatch is a finding, an inconclusive run
// is an absence of one, and a caller that treats them alike relearns this bug.
if (TRANSPORT === "both" && skipped.length > 0) process.exit(3);
process.exit(allMatch || TRANSPORT !== "both" ? 0 : 1);
