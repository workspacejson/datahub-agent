#!/usr/bin/env node
/**
 * Judge verification orchestration with PASS/FAIL/SKIP ledger output.
 *
 * Runs each gate in sequence, emits a compact ledger, and exits non-zero on
 * any required FAIL. Parity is SKIP when the old-side checkout is not
 * available (set PARITY_OLD_SIDE to enable).
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
 * @typedef {{ name: string, status: "PASS" | "FAIL" | "SKIP", detail: string, required: boolean }} GateResult
 */

/**
 * @param {string} label
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ required?: boolean, skipCondition?: () => string | null }} [opts]
 * @returns {GateResult}
 */
function runGate(label, cmd, args, opts) {
  const required = opts?.required ?? true;
  const skipReason = opts?.skipCondition?.();
  if (skipReason) {
    return { name: label, status: "SKIP", detail: skipReason, required };
  }
  try {
    execFileSync(cmd, args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
      maxBuffer: 10 * 1024 * 1024,
    });
    return { name: label, status: "PASS", detail: "exit 0", required };
  } catch (err) {
    const stderr = err.stderr?.trim() ?? err.message;
    const lastLines = stderr.split("\n").slice(-5).join("\n");
    return { name: label, status: "FAIL", detail: lastLines, required };
  }
}

const results = [];

// Gate 1: Typecheck
results.push(
  runGate("typecheck", process.execPath, ["node_modules/.bin/tsc", "--noEmit"]),
);

// Gate 2: Clean-room audit
results.push(
  runGate("clean-room", process.execPath, ["scripts/check-clean-room.mjs"], {
    skipCondition: () =>
      !existsSync(join(repoRoot, "scripts/check-clean-room.mjs"))
        ? "scripts/check-clean-room.mjs not found"
        : null,
  }),
);

// Gate 3: Tests
results.push(
  runGate("tests", process.execPath, ["node_modules/.bin/vitest", "run"], {
    skipCondition: () =>
      !existsSync(join(repoRoot, "node_modules/.bin/vitest"))
        ? "vitest not installed"
        : null,
  }),
);

// Gate 4: Cockpit tests
results.push(
  runGate("cockpit-tests", "npm", ["run", "test:cockpit"], {
    required: false,
    skipCondition: () =>
      !existsSync(join(repoRoot, "apps/cockpit/package.json"))
        ? "apps/cockpit not found"
        : null,
  }),
);

// Gate 5: Parity (manual — requires PARITY_OLD_SIDE or network fetch)
results.push(
  runGate("parity", "npm", ["run", "parity:datahub-adapter"], {
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
const padDetail = Math.max(...results.map((r) => r.detail.length), 6);

const sep = `+-${"-".repeat(padName)}-+-${"-".repeat(padStatus)}-+-${"-".repeat(padDetail)}-+`;
const header = `| ${"Gate".padEnd(padName)} | ${"Status".padEnd(padStatus)} | ${"Detail".padEnd(padDetail)} |`;

console.log("\n Judge verification ledger");
console.log(sep);
console.log(header);
console.log(sep);
for (const r of results) {
  console.log(`| ${r.name.padEnd(padName)} | ${r.status.padEnd(padStatus)} | ${r.detail.padEnd(padDetail)} |`);
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
