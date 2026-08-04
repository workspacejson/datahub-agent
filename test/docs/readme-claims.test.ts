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

type GoldenFixture = {
  datahub: {
    upstreams: unknown[];
    downstreams: unknown[];
    lineageObservation: {
      upstreams: { observedCount: number };
      downstreams: { observedCount: number };
    };
  };
  code: { dbtFilePath: string; repositoryRelativePath: string; projectPrefix: string };
  evidence: { records: unknown[]; tier: string };
  provenance: { workspaceArtifact: { fileIndexKeys: number } | null };
  writeback: { succeeded: boolean; bothStatesRead: boolean; noop: boolean } | null;
};

const goldenNested: GoldenFixture = JSON.parse(
  readFileSync(join(repoRoot, "test/fixtures/golden/change-impact-event.nested.json"), "utf8"),
);

describe("the README makes no perishable count claim", () => {
  it("does not assert a test count", () => {
    // Any "N test(s)" phrasing. The fix for the original defect was to stop
    // asserting the number at all, not to update it — an updated number is the
    // same defect with a later expiry date.
    //
    // "N test node(s)" is excluded, and the exclusion is narrow on purpose. A
    // dbt `test` node is a manifest resource type, not an assertion in this
    // repository's suite: "20 test nodes excluded by policy" is a fixed property
    // of a pinned corpus and cannot go stale on a merge, which is the only thing
    // this guard exists to catch. Excluding it by meaning keeps the alt text on
    // the node-accounting image, which the asset registry governs verbatim,
    // rather than rewording a governed string to satisfy a regex.
    const counts = README.match(/\b\d+\s+tests?\b(?!\s+nodes?\b)/gi) ?? [];
    expect(counts, `README asserts a perishable test count: ${counts.join(", ")}`).toEqual([]);
  });

  it("still catches a suite count that hides beside the node-type exclusion", () => {
    // The detector for the exclusion above. Without it, narrowing the regex
    // could be widened later into a hole big enough for the original defect.
    const withSuiteCount = README.replace("## Known limitations", "## Known limitations\n\n27 tests cover this.");
    expect(withSuiteCount.match(/\b\d+\s+tests?\b(?!\s+nodes?\b)/gi) ?? []).not.toEqual([]);
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
    // The single most misreadable state in the artifact. The root fixture
    // (Jaffle Shop) still carries it, so a reader who takes it as a defect
    // concludes the whole evidence surface is broken.
    expect(README).toMatch(/not-established.*(honest|not a shortfall)/is);
  });

  it("says the nested fixture carries complete-against-pinned-manifest", () => {
    // The nested fixture (Transfermarkt) now carries this state backed by
    // HAC-231's readiness manifests. The README must explain it as the
    // verified state, not leave a reader to discover it in the fixture alone.
    expect(README).toMatch(/complete-against-pinned-manifest.*nested|nested.*complete-against-pinned-manifest/is);
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

describe("the README's concrete-example figures match the nested golden fixture", () => {
  // The README's "One concrete example" table states specific values for the
  // nested golden fixture (Transfermarkt corpus). Those values are the ones a
  // judge reads most carefully. If the fixture is re-emitted and a value
  // changes, the README must be updated deliberately — not silently. This test
  // pins each stated figure to the fixture's actual value so drift fails CI.
  //
  // This is the insurance against the "27 tests" defect recurring in a new
  // shape: a number written once in prose, never re-checked against the
  // artifact it describes.

  it("states the upstream count the fixture carries", () => {
    expect(README).toContain(`${goldenNested.datahub.lineageObservation.upstreams.observedCount} upstream`);
    expect(goldenNested.datahub.upstreams.length).toBe(goldenNested.datahub.lineageObservation.upstreams.observedCount);
  });

  it("states the downstream count the fixture carries", () => {
    expect(README).toContain(`${goldenNested.datahub.lineageObservation.downstreams.observedCount} downstream`);
    expect(goldenNested.datahub.downstreams.length).toBe(goldenNested.datahub.lineageObservation.downstreams.observedCount);
  });

  it("states the evidence tier and record count the fixture carries", () => {
    expect(README).toContain(goldenNested.evidence.tier);
    expect(README).toContain(`${goldenNested.evidence.records.length} of ${goldenNested.evidence.records.length} record`);
  });

  it("states the fileIndex key count the fixture carries", () => {
    expect(README).toContain(`${goldenNested.provenance.workspaceArtifact?.fileIndexKeys} keys`);
  });

  it("states the project prefix the fixture carries", () => {
    expect(README).toContain(goldenNested.code.projectPrefix);
  });

  it("states the dbt file path the fixture carries", () => {
    expect(README).toContain(goldenNested.code.dbtFilePath);
  });

  it("states the writeback outcomes the fixture carries", () => {
    expect(README).toContain(`succeeded: ${goldenNested.writeback?.succeeded}`);
    expect(README).toContain(`bothStatesRead: ${goldenNested.writeback?.bothStatesRead}`);
    expect(README).toContain(`noop: ${goldenNested.writeback?.noop}`);
  });
});
