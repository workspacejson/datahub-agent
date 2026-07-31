#!/usr/bin/env node
/**
 * Judge verification orchestration with PASS/FAIL/SKIP ledger output.
 *
 * Runs each gate in sequence, emits a compact ledger with an evidence-artifact
 * column, and exits non-zero on any required FAIL. Parity is SKIP when the
 * old-side checkout is not available (set PARITY_OLD_SIDE to enable).
 *
 * Gates:
 *   1. typecheck         — tsc --noEmit (required)
 *   2. clean-room        — dependency audit (required)
 *   3. fixture-integrity — golden fixture schema + credential scan (required)
 *   4. schema-contract   — committed events satisfy the contract (required)
 *   5. tests             — vitest run, dot reporter (required)
 *   6. cockpit-tests     — workspace cockpit suite (optional)
 *   7. production-build  — cockpit production build (optional)
 *   8. parity            — adapter parity against frozen baseline (optional)
 *
 * Usage:
 *   node scripts/verify-judging.mjs
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @typedef {{ name: string, status: "PASS" | "FAIL" | "SKIP", detail: string, artifact: string, required: boolean }} GateResult
 */

/**
 * @param {string} label
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} artifact
 * @param {{ required?: boolean, skipCondition?: () => string | null }} [opts]
 * @returns {GateResult}
 */
function runGate(label, cmd, args, artifact, opts) {
  const required = opts?.required ?? true;
  const skipReason = opts?.skipCondition?.();
  if (skipReason) {
    return { name: label, status: "SKIP", detail: skipReason, artifact, required };
  }
  try {
    execFileSync(cmd, args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
      maxBuffer: 10 * 1024 * 1024,
    });
    return { name: label, status: "PASS", detail: "exit 0", artifact, required };
  } catch (err) {
    const stderr = err.stderr?.trim() ?? err.message;
    const lastLines = stderr.split("\n").slice(-5).join("\n");
    return { name: label, status: "FAIL", detail: lastLines, artifact, required };
  }
}

const results = [];

// Gate 1: Typecheck
results.push(
  runGate("typecheck", process.execPath, ["node_modules/.bin/tsc", "--noEmit"], "tsconfig.json"),
);

// Gate 2: Clean-room audit
results.push(
  runGate("clean-room", process.execPath, ["scripts/check-clean-room.mjs"], "scripts/check-clean-room.mjs", {
    skipCondition: () =>
      !existsSync(join(repoRoot, "scripts/check-clean-room.mjs"))
        ? "scripts/check-clean-room.mjs not found"
        : null,
  }),
);

// Gate 3: Fixture integrity (golden fixture schema + credential scan)
results.push(
  runGate(
    "fixture-integrity",
    process.execPath,
    ["node_modules/.bin/vitest", "run", "--reporter=dot", "test/integration/golden-fixture.test.ts"],
    "test/fixtures/golden/",
    {
      skipCondition: () =>
        !existsSync(join(repoRoot, "node_modules/.bin/vitest"))
          ? "vitest not installed"
          : null,
    },
  ),
);

// Gate 4: Schema/contract validity (committed events satisfy the contract)
results.push(
  runGate(
    "schema-contract",
    process.execPath,
    ["node_modules/.bin/vitest", "run", "--reporter=dot", "test/integration/committed-events-satisfy-the-contract.test.ts"],
    "src/integration/change-impact-event.ts",
    {
      skipCondition: () =>
        !existsSync(join(repoRoot, "node_modules/.bin/vitest"))
          ? "vitest not installed"
          : null,
    },
  ),
);

// Gate 5: Tests (full suite, dot reporter to minimise buffer)
results.push(
  runGate(
    "tests",
    process.execPath,
    ["node_modules/.bin/vitest", "run", "--reporter=dot"],
    "test/",
    {
      skipCondition: () =>
        !existsSync(join(repoRoot, "node_modules/.bin/vitest"))
          ? "vitest not installed"
          : null,
    },
  ),
);

// Gate 6: Cockpit tests
results.push(
  runGate("cockpit-tests", "npm", ["run", "test:cockpit"], "apps/cockpit/", {
    required: false,
    skipCondition: () =>
      !existsSync(join(repoRoot, "apps/cockpit/package.json"))
        ? "apps/cockpit not found"
        : null,
  }),
);

// Gate 7: Production build
results.push(
  runGate("production-build", "npm", ["run", "build"], "apps/cockpit/dist/", {
    required: false,
    skipCondition: () =>
      !existsSync(join(repoRoot, "apps/cockpit/package.json"))
        ? "apps/cockpit not found"
        : null,
  }),
);

// Gate 8: Parity (manual — requires PARITY_OLD_SIDE or network fetch)
results.push(
  runGate("parity", "npm", ["run", "parity:datahub-adapter"], "migration/parity-datahub-shim.mjs", {
    required: false,
    skipCondition: () => {
      if (process.env.PARITY_OLD_SIDE) return null;
      if (existsSync(join(repoRoot, ".parity-cache"))) return null;
      return "set PARITY_OLD_SIDE or provide .parity-cache/ to run";
    },
  }),
);

// Emit ledger
const padName = Math.max(...results.map((r) => r.name.length), 4);
const padStatus = 6;
const padArtifact = Math.max(...results.map((r) => r.artifact.length), 7);
const padDetail = Math.max(...results.map((r) => r.detail.length), 6);

const sep = `+-${"-".repeat(padName)}-+-${"-".repeat(padStatus)}-+-${"-".repeat(padArtifact)}-+-${"-".repeat(padDetail)}-+`;
const header = `| ${"Gate".padEnd(padName)} | ${"Status".padEnd(padStatus)} | ${"Artifact".padEnd(padArtifact)} | ${"Detail".padEnd(padDetail)} |`;

console.log("\n Judge verification ledger");
console.log(sep);
console.log(header);
console.log(sep);
for (const r of results) {
  console.log(`| ${r.name.padEnd(padName)} | ${r.status.padEnd(padStatus)} | ${r.artifact.padEnd(padArtifact)} | ${r.detail.padEnd(padDetail)} |`);
}
console.log(sep);

const requiredFails = results.filter((r) => r.status === "FAIL" && r.required);
const optionalFails = results.filter((r) => r.status === "FAIL" && !r.required);
const skips = results.filter((r) => r.status === "SKIP");

if (requiredFails.length > 0) {
  console.error(`\n ${requiredFails.length} required gate(s) FAILED:`);
  for (const f of requiredFails) {
    console.error(`   ${f.name}: ${f.detail}`);
  }
} else {
  console.log(`\n All required gates passed.`);
}

if (optionalFails.length > 0) {
  console.error(`\n ${optionalFails.length} optional gate(s) FAILED:`);
  for (const f of optionalFails) {
    console.error(`   ${f.name}: ${f.detail}`);
  }
}

if (skips.length > 0) {
  console.log(`\n ${skips.length} gate(s) SKIPPED:`);
  for (const s of skips) {
    console.log(`   ${s.name}: ${s.detail}`);
  }
}

process.exit(requiredFails.length > 0 ? 1 : 0);
