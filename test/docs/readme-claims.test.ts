/**
 * The README is the surface a judge reads first, and it is the one place in this
 * repository where a claim can go stale without anything failing.
 *
 * It carried `npm test  # 27 tests` long after the real number had passed 400.
 * Nobody lied; the number was written once and never re-checked. That is the
 * exact failure this project is organised against, sitting on the page a reader
 * trusts most — so it gets a test rather than a resolution to be careful.
 *
 * These check the *shape* of what the README asserts, not its prose. A document
 * that says what a command does cannot drift; one that says how many assertions
 * the command contains drifts on the next merge.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const README = readFileSync(join(repoRoot, "README.md"), "utf8");

describe("the README makes no perishable count claim", () => {
  it("does not assert a test count", () => {
    // Any "N test(s)" phrasing. The fix for the original defect was to stop
    // asserting the number at all, not to update it — an updated number is the
    // same defect with a later expiry date.
    const counts = README.match(/\b\d+\s+tests?\b/gi) ?? [];
    expect(counts, `README asserts a perishable test count: ${counts.join(", ")}`).toEqual([]);
  });

  it("still tells a reader how to run the suite", () => {
    // The guard above is satisfied by deleting the section entirely, which would
    // be worse than a stale number. This is what stops that.
    expect(README).toMatch(/npm test/);
    expect(README).toMatch(/npm run typecheck/);
  });

  it("would catch the claim coming back", () => {
    // The detector, against the exact string that was there. Without this the
    // test above passes on any document that happens not to contain a number.
    const regressed = README.replace(
      "npm test                        # contract, writeback, join, and cockpit suites",
      "npm test                        # 27 tests, incl. the URN -> evidence integration test",
    );
    expect(regressed).not.toBe(README);
    expect(regressed.match(/\b\d+\s+tests?\b/gi) ?? []).not.toEqual([]);
  });
});

describe("the README explains the evidence vocabulary a cold reader will meet", () => {
  // HAC-146's acceptance names the README as a consumer of the frozen contract.
  // It was *vacuously* compliant — no translation layer, because it mentioned
  // none of the words. A judge who opens an emitted event and finds
  // `not-established` needs to know that is the honest state and not a shortfall.

  it.each([
    "not-queried",
    "complete-against-pinned-manifest",
    "not-established",
    "checkExecuted",
    "bothStatesRead",
    "indeterminate",
  ])("names %s", (term) => {
    expect(README).toContain(term);
  });

  it("says plainly that not-established is honest rather than a shortfall", () => {
    // The single most misreadable state in the artifact. Every lineage read this
    // repository emits carries it, so a reader who takes it as a defect
    // concludes the whole evidence surface is broken.
    expect(README).toMatch(/not-established.*(honest|not a shortfall)/is);
  });

  it("does not present a bare VERIFIED tier", () => {
    // The same rule the cockpit is held to: the tier is a fact about records
    // that reads as a warrant about claims.
    const bare = README.match(/(?<![-`\w])VERIFIED(?![-`\w])/g) ?? [];
    for (const _ of bare) {
      expect(README).toMatch(/VERIFIED.{0,120}(record|counts that produced)/is);
    }
  });
});
