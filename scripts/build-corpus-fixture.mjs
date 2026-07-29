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
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { execFileSync, spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = join(repoRoot, "test/fixtures/proof-corpus");

const PINNED_SHA = "36bde6cba69d962b83be1d52fc65a0dce1cb4ebb";
const CORPUS = "dbt-labs/jaffle_shop_duckdb";

// Fields retained from each manifest node. Everything dropped is payload the
// join never reads (compiled_code, raw_code, columns, docs, config, depends_on).
// Retained values are copied verbatim — none are rewritten.
//
// `depends_on` is dropped *here* because the URN join does not read it. That is
// not a statement that the project has no use for it: HAC-231's readiness
// manifests are derived from `depends_on`, `parent_map` and `child_map`, by
// `scripts/derive-readiness-manifest.mjs`, which reads a checkout's own
// `target/manifest.json` directly and never consults this fixture. Do not read
// this list as "dbt dependency data is unavailable" — it is unavailable in this
// artifact, on purpose, and lives in that derivation instead.
//
// This script is also pinned to jaffle_shop_duckdb and refuses other checkouts
// (see the SHA guard below). It is deliberately not the vehicle for the
// transfermarkt readiness manifests, whose governance requires manifest
// generation to be a separate explicit command.
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

// The workspace.json artifact, produced by the REAL published producer.
//
// This previously synthesized a fileIndex from `git ls-files` with empty
// values, because `@workspacejson/cli` was unpublished (npm 404) and
// docs/clean-room.md forbids consuming it from source. It is published now, so
// the fixture is a genuine producer run against the pinned corpus — the same
// artifact a judge gets from the same public command.
//
// Per-file values are still empty, and that is the producer's own ratified
// behavior rather than a shortcut taken here: `FileIndexEntry` declares every
// value field optional, and the producer deliberately withholds behavioral
// values. The join under test is key membership, exercised exactly as a real
// consumer would.
// Resolved with `import.meta.resolve`, not `createRequire().resolve`. The
// package's `exports` map declares only an `import` condition — correct for an
// ESM package — so CJS resolution throws ERR_PACKAGE_PATH_NOT_EXPORTED. Its
// `./package.json` subpath is likewise unexported, so the manifest is read by
// path after walking up from the resolved entry rather than required.
const cliMain = fileURLToPath(import.meta.resolve("@workspacejson/cli"));
const cliPackageDir = dirname(dirname(cliMain));
const cliEntry = join(cliPackageDir, "dist", "cli.js");
const producerVersion = JSON.parse(readFileSync(join(cliPackageDir, "package.json"), "utf8")).version;

const generate = spawnSync(process.execPath, [cliEntry, "generate", resolve(checkout)], {
  encoding: "utf8",
  cwd: resolve(checkout),
});
if (generate.status !== 0) {
  console.error(`The producer failed (exit ${generate.status}).`);
  console.error(`${generate.stdout ?? ""}${generate.stderr ?? ""}`);
  process.exit(2);
}

const artifactPath = join(resolve(checkout), ".agents", "workspace.json");
if (!existsSync(artifactPath)) {
  console.error(`The producer reported success but wrote no artifact at ${artifactPath}.`);
  process.exit(2);
}

const produced = JSON.parse(readFileSync(artifactPath, "utf8"));
const fileIndex = produced.generated?.fileIndex ?? {};

// An empty index would make every join vacuously pass. Refuse rather than
// commit a fixture that cannot fail.
if (Object.keys(fileIndex).length === 0) {
  console.error("The producer emitted an empty fileIndex. Refusing to write a fixture that would make every join vacuously pass.");
  process.exit(2);
}

// Do not reshape the producer artifact. The standard has an exact root schema;
// adding `_provenance` or dropping required sections turns a valid producer
// result into an invalid fixture. Provenance belongs beside the raw artifact.
//
// The command is recorded portably. It was previously the absolute path of the
// resolved CLI entry on whatever machine ran the build, which is not a command
// anyone else can run — and a derivation command a reader cannot execute is not
// preserved provenance, it is a note that looks like one.
const workspaceProvenance = {
  corpus: `https://github.com/${CORPUS}`,
  commit: PINNED_SHA,
  producer: `@workspacejson/cli@${producerVersion}`,
  generated_by: "scripts/build-corpus-fixture.mjs",
  command: "node scripts/build-corpus-fixture.mjs <checkout-at-the-pinned-commit>",
  file_count: Object.keys(fileIndex).length,
  note: "workspace.json is the unmodified raw producer output. Per-file values are producer-owned; this sidecar carries fixture provenance without changing the standard artifact.",
};

mkdirSync(outDir, { recursive: true });
const workspaceContents = `${JSON.stringify(produced, null, 2)}\n`;
// Bind the provenance to exactly the bytes committed as workspace.json. A
// sidecar must never be able to relabel an arbitrary artifact as this producer
// run; consumers verify this digest before using workspace-derived claims.
workspaceProvenance.workspace_sha256 = createHash("sha256")
  .update(workspaceContents)
  .digest("hex");
writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(fixture, null, 2)}\n`);
writeFileSync(join(outDir, "workspace.json"), workspaceContents);
writeFileSync(join(outDir, "workspace-provenance.json"), `${JSON.stringify(workspaceProvenance, null, 2)}\n`);

console.log(`corpus:      ${CORPUS}@${PINNED_SHA}`);
console.log(`dbt:         ${manifest.metadata?.dbt_version} / ${manifest.metadata?.adapter_type}`);
console.log(`nodes:       ${Object.keys(nodes).length}`);
console.log(`sources:     ${Object.keys(manifest.sources ?? {}).length}`);
console.log(`producer:    @workspacejson/cli@${producerVersion} (published)`);
console.log(`fileIndex:   ${Object.keys(fileIndex).length} keys from a real producer run`);
console.log(`written to:  ${outDir}`);
