import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * The silent-zero proof script is the public, directly executable verification
 * path for the 0/5, exit 0 claim. It runs the naive join against the frozen
 * proof corpus with a nested `dbt/` prefix, asserts 0/5 matches, no error, and
 * exit 0. The repaired path is demonstrated separately in the same run.
 *
 * This test runs the script as a subprocess and asserts the deterministic JSON
 * output and exit code, so the proof is machine-checked rather than trusted.
 */
describe("scripts/prove-silent-zero.mjs", () => {
  const run = () => {
    const stdout = execFileSync(
      process.execPath,
      [join(repoRoot, "scripts/prove-silent-zero.mjs")],
      { cwd: repoRoot, encoding: "utf8" },
    );
    return JSON.parse(stdout);
  };

  it("exits 0 and produces valid JSON", () => {
    // execFileSync throws on non-zero exit, so reaching this assertion means
    // exit 0. The JSON parse confirms the output is structured, not prose.
    const result = run();
    expect(result.proof).toBe("silent-zero");
  });

  it("naive join matches 0 of 5 models with no error", () => {
    const result = run();
    expect(result.naive.matched).toBe(0);
    expect(result.naive.total).toBe(5);
    expect(result.naive.matchedRows).toBe(0);
  });

  it("repaired join matches 5 of 5 models with the dbt prefix", () => {
    const result = run();
    expect(result.repaired.matched).toBe(5);
    expect(result.repaired.total).toBe(5);
    expect(result.repaired.prefix).toBe("dbt");
    expect(result.repaired.firstNormalizedKey).toBe("dbt/models/customers.sql");
  });

  it("all assertions pass", () => {
    const result = run();
    for (const a of result.assertions) {
      expect(a.ok, a.name).toBe(true);
    }
  });

  it("exitCode field is 0", () => {
    const result = run();
    expect(result.exitCode).toBe(0);
  });
});
