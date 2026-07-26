#!/usr/bin/env node
/**
 * Regenerate the committed proof-corpus fixtures from a checkout of the frozen
 * corpus (HAC-143). Committed fixtures keep the integration test hermetic; this
 * script is what makes them reproducible rather than hand-authored.
 *
 * Usage:
 *   node scripts/build-corpus-fixture.mjs <path-to-jaffle_shop_duckdb-checkout>
 *
 * The checkout must be at the pinned commit and must have had `dbt docs
 * generate` (or `dbt parse`) run, so `target/manifest.json` exists.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = join(repoRoot, "test/fixtures/proof-corpus");

const PINNED_SHA = "36bde6cba69d962b83be1d52fc65a0dce1cb4ebb";
const CORPUS = "dbt-labs/jaffle_shop_duckdb";

// Fields retained from each manifest node. Everything dropped is payload the
// join never reads (compiled_code, raw_code, columns, docs, config, depends_on).
// Retained values are copied verbatim — none are rewritten.
const KEEP = [
  "resource_type", "unique_id", "original_file_path",
  "database", "schema", "alias", "name", "language", "relation_name",
];

const checkout = process.argv[2];
if (!checkout) {
  console.error("usage: node scripts/build-corpus-fixture.mjs <corpus-checkout>");
  process.exit(2);
}
const manifestPath = join(resolve(checkout), "target/manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`No manifest at ${manifestPath}. Run \`dbt docs generate\` in the checkout first.`);
  process.exit(2);
}

const sha = execFileSync("git", ["-C", resolve(checkout), "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (sha !== PINNED_SHA) {
  console.error(`Checkout is at ${sha}, not the pinned ${PINNED_SHA}. Refusing to build fixtures from an unpinned tree.`);
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const nodes = {};
for (const [id, node] of Object.entries(manifest.nodes ?? {})) {
  const trimmed = {};
  for (const k of KEEP) if (node[k] !== undefined) trimmed[k] = node[k];
  nodes[id] = trimmed;
}

const fixture = {
  _provenance: {
    corpus: `https://github.com/${CORPUS}`,
    commit: PINNED_SHA,
    dbt_version: manifest.metadata?.dbt_version ?? null,
    adapter_type: manifest.metadata?.adapter_type ?? null,
    project_name: manifest.metadata?.project_name ?? null,
    generated_by: "scripts/build-corpus-fixture.mjs",
    note: `Node payload trimmed to the fields the join reads (${KEEP.join(", ")}). Values are verbatim; none are rewritten. Regenerate with the script above.`,
  },
  metadata: manifest.metadata,
  nodes,
  sources: manifest.sources ?? {},
};

// The fileIndex the workspace.json producer would key for this repository:
// every tracked file, repository-root-relative POSIX (VR-640).
//
// LIMITATION, recorded deliberately: `@workspacejson/cli` is not published to
// npm (404 at time of writing), and docs/clean-room.md forbids consuming it
// from source. So this is NOT the output of a real producer run — it is the
// real file list the producer keys on, with empty evidence values. The join
// under test is key-membership, which this exercises faithfully; the evidence
// payloads are not exercised and no claim is made about them.
const tracked = execFileSync("git", ["-C", resolve(checkout), "ls-files"], { encoding: "utf8" })
  .split("\n").map((s) => s.trim()).filter(Boolean);

const fileIndex = {};
for (const f of tracked) fileIndex[f] = {};

const workspace = {
  _provenance: {
    corpus: `https://github.com/${CORPUS}`,
    commit: PINNED_SHA,
    generated_by: "scripts/build-corpus-fixture.mjs",
    note: "NOT a real @workspacejson/cli producer run — that package is unpublished and clean-room rules forbid source consumption. Keys are the corpus's real tracked file list (git ls-files); evidence values are intentionally empty. Exercises key membership only.",
    file_count: tracked.length,
  },
  generated: { fileIndex },
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(fixture, null, 2)}\n`);
writeFileSync(join(outDir, "workspace.json"), `${JSON.stringify(workspace, null, 2)}\n`);

console.log(`corpus:      ${CORPUS}@${PINNED_SHA}`);
console.log(`dbt:         ${manifest.metadata?.dbt_version} / ${manifest.metadata?.adapter_type}`);
console.log(`nodes:       ${Object.keys(nodes).length}`);
console.log(`sources:     ${Object.keys(manifest.sources ?? {}).length}`);
console.log(`fileIndex:   ${tracked.length} tracked files`);
console.log(`written to:  ${outDir}`);
