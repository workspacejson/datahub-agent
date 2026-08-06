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

describe("the README claims no behavioral co-change the bound event does not carry", () => {
  /*
    The cockpit already fixed this once, in prose, with nothing pinning it.

    "DataHub says where data flows; git says what breaks together" claimed
    exactly the capability the receipt disclaims, and it was landed as "git says
    where each file lives" (see `docs/internal/cockpit-ideal-state-gap.md`). The README
    then reintroduced the same claim in two different words: a reviewer seeing
    "behavioral coupling", and co-change partners listed among what
    `workspace.json` contributes.

    Both are the appealing version of the claim, which is why the wording keeps
    coming back. The producer withholds behavioral values by design, the join
    exercises key membership rather than value reading, and the bound event
    carries `partners: []`. So the guard is pinned to the event rather than to a
    banned-word list alone: if a future event ever does carry partners, the
    positive assertion below relaxes on its own instead of forcing someone to
    edit a test to state something newly true.
  */
  const partners = (goldenNested as unknown as { partners?: unknown[] }).partners ?? [];

  it("is checked against an event that establishes no partners", () => {
    expect(partners).toEqual([]);
  });

  it.each([
    "behavioral coupling",
    "behavioural coupling",
    "what breaks together",
  ])("does not assert %s", (phrase) => {
    expect(README.toLowerCase(), `README asserts "${phrase}", which the bound event does not establish`).not.toContain(
      phrase,
    );
  });

  it("mentions behaviour only to disclaim it", () => {
    /*
      A phrase list is whack-a-mole. The claim came back three times in three
      wordings -- "behavioral coupling", "a reviewer can tell a declaration from
      a behaviour", and co-change partners listed as a contribution -- so the
      rule is about meaning: this README may name behaviour, but only in a
      sentence that says it is not established.

      Deliberately not a ban on the word. "The producer withholds behavioral
      values by design" is the honest limitation and has to stay sayable.
    */
    const DISCLAIMERS = /\b(not|no|never|withholds|thin for|illustrative)\b/i;
    const offenders = README.split(/(?<=\.)\s+/)
      .filter((sentence) => /behavio(u?)r/i.test(sentence))
      .filter((sentence) => !DISCLAIMERS.test(sentence));
    expect(offenders, `README names behaviour without disclaiming it: ${offenders.join(" | ")}`).toEqual([]);
  });

  it("says plainly that the bound event does not establish co-change partners", () => {
    if (partners.length > 0) return;
    expect(README).toMatch(/does not establish behavio(u?)ral co-change partners/i);
  });

  it("would catch the claim coming back in either of its previous shapes", () => {
    // The detector, against both exact strings that were there. Without it the
    // assertions above pass on any document that happens not to use the words.
    for (const regressed of [
      README.replace(
        "while keeping repository identity separate from catalog dependency claims",
        "so a reviewer sees both catalog dependencies and behavioral coupling",
      ),
      README.replace(
        "The artifact carries its own provenance",
        "Co-change partners, churn, and fragility are repository evidence. The artifact carries its own provenance",
      ),
    ]) {
      expect(regressed).not.toBe(README);
    }
    expect(
      README.replace(
        "while keeping repository identity separate from catalog dependency claims",
        "so a reviewer sees both catalog dependencies and behavioral coupling",
      ).toLowerCase(),
    ).toContain("behavioral coupling");
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
