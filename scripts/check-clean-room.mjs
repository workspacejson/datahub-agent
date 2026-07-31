#!/usr/bin/env node
/**
 * Enforce the clean-room import rule against this repository's manifests.
 *
 * `docs/clean-room.md` names dependency manifests as the source of truth: every
 * workspacejson-origin dependency must resolve to a published version, never a
 * local, link, or git reference into a private checkout. This is that rule as a
 * command.
 *
 * Offline and structural — it reads the manifests, never the network, so it
 * answers the same way in CI and in a judge's checkout.
 *
 * Usage:
 *   node scripts/check-clean-room.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const { auditCleanRoom, controlledDependencies } = await import(
  join(repoRoot, "src/policy/clean-room.ts")
).catch(async () => {
  const api = await import("tsx/esm/api");
  api.register();
  return import(join(repoRoot, "src/policy/clean-room.ts"));
});

const read = (name) => JSON.parse(readFileSync(join(repoRoot, name), "utf8"));

const pkg = read("package.json");
const lock = read("package-lock.json");

const violations = auditCleanRoom(pkg, lock);
const controlled = controlledDependencies(pkg);

console.log("Clean-room import rule — docs/clean-room.md\n");
console.log(`  manifests   package.json, package-lock.json (lockfileVersion ${lock.lockfileVersion})`);
console.log(`  packages    ${Object.keys(lock.packages ?? {}).length - 1} resolved`);

console.log("\n  Controlled dependencies (workspacejson / private repository origin):");
if (controlled.length === 0) {
  console.log("    (none declared)");
} else {
  for (const { name, spec } of controlled) console.log(`    ${name.padEnd(24)} ${spec}`);
}

if (violations.length === 0) {
  console.log("\n  PASS — every dependency resolves to a published registry version.");
  process.exit(0);
}

console.error(`\n  FAIL — ${violations.length} violation(s):\n`);
for (const { where, problem } of violations) {
  console.error(`    ${where}`);
  console.error(`      ${problem}\n`);
}
console.error("  The rule permits released, published packages only. A capability missing");
console.error("  from a released package is contributed upstream, not reached for locally.");
process.exit(1);
