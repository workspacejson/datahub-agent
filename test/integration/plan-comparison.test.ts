import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { ChangeImpactEvent } from "../../src/integration/change-impact-event.js";
import {
  JUDGE_RUN_BUNDLE_VERSION,
  PLAN_COMPARISON_VERSION,
  type JudgeRunBundle,
  type PlanComparisonArtifact,
  type RunIdentity,
  digestEvent,
  evidenceRefsOf,
  looksLikePlaceholder,
  sameRunIdentity,
  toComparisonState,
  validateBundle,
} from "../../src/integration/plan-comparison.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** A real emitted event, so the references under test resolve against real evidence. */
const event = JSON.parse(
  readFileSync(join(repoRoot, "test/fixtures/golden/change-impact-event.root.json"), "utf8"),
) as ChangeImpactEvent;

const RUN: RunIdentity = {
  taskId: "add-a-customer-lifetime-value-column",
  promptDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  model: "claude-opus-5",
  settingsDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
};

function comparison(over: Partial<PlanComparisonArtifact> = {}): PlanComparisonArtifact {
  return {
    artifactVersion: PLAN_COMPARISON_VERSION,
    eventDigest: digestEvent(event),
    snapshot: {
      repository: event.provenance.corpus.repository as string,
      revision: event.provenance.corpus.commit as string,
      datahub: {
        gmsUrl: event.provenance.datahub.gmsUrl,
        eventProducedAt: event.provenance.producedAt,
      },
    },
    datahubOnlyPlan: {
      mode: "datahub-only",
      run: RUN,
      steps: [
        { id: "s1", action: "edit models/customers.sql to add the new column" },
        { id: "s2", action: "run dbt build for the customers model" },
      ],
    },
    joinedPlan: {
      mode: "joined",
      run: RUN,
      steps: [
        { id: "s1", action: "edit models/customers.sql to add the new column" },
        { id: "s3", action: "check the three staging models that feed customers before editing" },
        { id: "s2", action: "run dbt build for the customers model" },
      ],
    },
    deltas: [
      {
        kind: "added",
        label: "inspect upstream staging models before editing",
        reason:
          "the joined artifact resolves the producing file exactly, and the catalog reports twelve upstream edges the DataHub-only plan never enumerated",
        evidenceRefs: ["evidence.records[0]", "datahub.upstreams[0]"],
      },
    ],
    ...over,
  };
}

const bundle = (over: Partial<PlanComparisonArtifact> = {}): JudgeRunBundle => ({
  bundleVersion: JUDGE_RUN_BUNDLE_VERSION,
  event,
  comparison: comparison(over),
});

describe("the carrier is separate from the evidence contract", () => {
  it("does not require the event contract to change", () => {
    // The ruling this encodes: 1.3 is the shared evidence input, and derived
    // agent outputs live in their own artifact. A bundle validates without the
    // event carrying any plan field.
    expect(validateBundle(bundle())).toEqual([]);
    expect(Object.keys(event)).not.toContain("plans");
    expect(Object.keys(event)).not.toContain("planDeltas");
  });

  it("digests the evidence only, so an attached writeback receipt cannot change it", () => {
    // The golden fixture is an *enriched* event: it carries a tenth key,
    // `writeback`, that `ChangeImpactEvent` does not declare. Digesting whatever
    // keys happened to be present meant a typed producer building a bare event
    // and a consumer parsing the emitted JSON computed different digests for the
    // same evidence, and the binding failed for a reason neither could see.
    //
    // It is also the right scope: the comparison is derived from the evidence,
    // and a writeback is a later action taken on the strength of it.
    const bare = { ...(event as unknown as Record<string, unknown>) };
    delete bare.writeback;
    expect(digestEvent(bare as unknown as ChangeImpactEvent)).toBe(digestEvent(event));

    const rewritten = JSON.parse(JSON.stringify(event)) as unknown as Record<string, unknown>;
    rewritten.writeback = { targetUrn: "urn:li:dataset:something-else", succeeded: false };
    expect(digestEvent(rewritten as unknown as ChangeImpactEvent)).toBe(digestEvent(event));
  });

  it("still changes the digest when the evidence itself changes", () => {
    const altered = JSON.parse(JSON.stringify(event)) as ChangeImpactEvent;
    altered.datahub.upstreams = altered.datahub.upstreams.slice(0, 3);
    expect(digestEvent(altered)).not.toBe(digestEvent(event));
  });

  it("digests an event independently of key order", () => {
    const reordered = JSON.parse(JSON.stringify(event)) as ChangeImpactEvent;
    const fields = reordered as unknown as Record<string, unknown>;
    const rebuilt = Object.fromEntries(
      Object.keys(fields).reverse().map((key) => [key, fields[key]]),
    ) as unknown as ChangeImpactEvent;
    expect(digestEvent(rebuilt)).toBe(digestEvent(event));
  });
});

describe("event-digest mismatch", () => {
  it("refuses a comparison derived from different evidence", () => {
    // The failure this exists to catch: two plans compared against evidence
    // other than the event they travel with. Every delta is then
    // unattributable, while the artifact still looks complete.
    const problems = validateBundle(bundle({ eventDigest: "sha256:not-the-event" }));
    expect(problems.join(" ")).toMatch(/eventDigest .* does not match/);
  });

  it("catches an event mutated after the comparison was derived", () => {
    const tampered = JSON.parse(JSON.stringify(event)) as ChangeImpactEvent;
    tampered.datahub.upstreams = tampered.datahub.upstreams.slice(0, 3);
    const problems = validateBundle({ ...bundle(), event: tampered });
    expect(problems.join(" ")).toMatch(/does not match the bundled event/);
  });
});

describe("unequal task, prompt, model or settings", () => {
  it.each([
    ["taskId", { taskId: "a-different-task" }],
    ["promptDigest", { promptDigest: "sha256:9999" }],
    ["model", { model: "some-other-model" }],
    ["settingsDigest", { settingsDigest: "sha256:8888" }],
  ])("refuses the pair when %s differs between the plans", (_field, override) => {
    // A delta produced under a changed setup is confounded by the setup change,
    // and says nothing about the joined context — which is the only thing the
    // artifact exists to demonstrate.
    const base = comparison();
    const problems = validateBundle({
      ...bundle(),
      comparison: {
        ...base,
        joinedPlan: { ...base.joinedPlan, run: { ...RUN, ...override } },
      },
    });
    expect(problems.join(" ")).toMatch(/different task, prompt, model, or settings/);
  });

  it("compares every field of the identity, not just the task", () => {
    expect(sameRunIdentity(RUN, RUN)).toBe(true);
    expect(sameRunIdentity(RUN, { ...RUN, model: "other" })).toBe(false);
  });
});

describe("missing evidence references", () => {
  it("refuses a delta that cites nothing", () => {
    const base = comparison();
    const problems = validateBundle({
      ...bundle(),
      comparison: {
        ...base,
        deltas: [{ ...base.deltas[0]!, evidenceRefs: [] }],
      },
    });
    expect(problems.join(" ")).toMatch(/cites no evidence/);
  });

  it("refuses a delta citing evidence the event does not contain", () => {
    const base = comparison();
    const problems = validateBundle({
      ...bundle(),
      comparison: {
        ...base,
        deltas: [{ ...base.deltas[0]!, evidenceRefs: ["evidence.records[99]"] }],
      },
    });
    expect(problems.join(" ")).toMatch(/cites evidence\.records\[99\], which the bundled event does not contain/);
  });

  it("does not accept a path that exists on the event but is not evidence", () => {
    // `code` and `provenance` resolve as object paths and support nothing. A
    // general path resolver would let a delta look backed while pointing at them.
    const refs = evidenceRefsOf(event);
    expect(refs.has("code")).toBe(false);
    expect(refs.has("provenance.corpus.commit")).toBe(false);
    expect(refs.has("evidence.records[0]")).toBe(true);
  });

  it("offers unavailable entries by index and by field name", () => {
    const refs = evidenceRefsOf(event);
    expect(refs.has("unavailable[0]")).toBe(true);
    expect(refs.has(`unavailable[${JSON.stringify(event.unavailable[0]!.field)}]`)).toBe(true);
  });
});

describe("placeholder leakage", () => {
  it.each([
    "<joined plan unavailable>",
    "TODO: describe the delta",
    "TBD",
    "placeholder reason",
    "see https://example.com/whatever",
    "  ",
  ])("recognises %j as placeholder text", (text) => {
    expect(looksLikePlaceholder(text)).toBe(true);
  });

  it("does not flag a real reason", () => {
    expect(
      looksLikePlaceholder(
        "the joined artifact resolves the producing file exactly, so the staging models can be enumerated",
      ),
    ).toBe(false);
  });

  it.each([
    "the catalog reported the upstream unavailable, so the plan adds a verification step",
    "the workspace artifact was unavailable, so no partner claim is made",
    "replaces the provisional adapter with the validated evidence binding",
  ])("does not flag domain vocabulary: %j", (text) => {
    // `unavailable` and `provisional` were in the pattern list to catch
    // `<joined plan unavailable>`. They caught it, and every legitimate sentence
    // containing either word — and `unavailable` is a first-class field name on
    // the event contract, so the words a real evidence-backed reason would use
    // were being rejected as scaffolding. The angle-bracket shape already
    // catches the actual placeholder.
    expect(looksLikePlaceholder(text)).toBe(false);
  });

  it("still refuses the angle-bracket form those words were added for", () => {
    expect(looksLikePlaceholder("<joined plan unavailable>")).toBe(true);
    expect(looksLikePlaceholder("<provisional>")).toBe(true);
  });

  it("refuses the exact string the provisional adapter ships", () => {
    // Not hypothetical: `apps/cockpit/src/data/provisional-source.ts` carries a
    // delta reading `<joined plan unavailable>`. Honest where it lives, and a
    // lie in a judge-facing artifact — so the carrier refuses it by name.
    const base = comparison();
    const problems = validateBundle({
      ...bundle(),
      comparison: {
        ...base,
        deltas: [{ ...base.deltas[0]!, label: "<joined plan unavailable>" }],
      },
    });
    expect(problems.join(" ")).toMatch(/label is placeholder text/);
  });

  it("refuses a placeholder inside a plan step", () => {
    const base = comparison();
    const problems = validateBundle({
      ...bundle(),
      comparison: {
        ...base,
        joinedPlan: {
          ...base.joinedPlan,
          steps: [{ id: "s1", action: "TODO: work out what to do here" }],
        },
      },
    });
    expect(problems.join(" ")).toMatch(/steps\[0\]\.action is placeholder text/);
  });
});

describe("an empty delta array is a result, not an absence", () => {
  it("accepts an observed comparison that found no delta", () => {
    // Legal, and meaningful: the joined context genuinely changed nothing.
    const state = toComparisonState(bundle({ deltas: [] }), "unused");
    expect(state.status).toBe("observed");
    if (state.status === "observed") expect(state.comparison.deltas).toEqual([]);
  });

  it("reports a missing comparison as unavailable with a reason, not as an empty result", () => {
    // The defect this splits apart: the cockpit rendered `planDeltas: []` both
    // for "no comparison exists" and for "the comparison found nothing", so a
    // missing input read as a finding.
    const state = toComparisonState(null, "no paired run has been executed for this subject");
    expect(state.status).toBe("unavailable");
    if (state.status === "unavailable") {
      expect(state.reason).toBe("no paired run has been executed for this subject");
      expect(state.reason.length).toBeGreaterThan(0);
    }
  });

  it("never presents a failed validation as an observed comparison with the bad deltas dropped", () => {
    // Rendering the survivors of a failed validation is how a partial artifact
    // becomes a confident one.
    const state = toComparisonState(bundle({ eventDigest: "sha256:wrong" }), "unused");
    expect(state.status).toBe("unavailable");
    if (state.status === "unavailable") expect(state.reason).toMatch(/did not validate/);
  });

  it("distinguishes the two states by shape, so neither can be read as the other", () => {
    const observed = toComparisonState(bundle({ deltas: [] }), "unused");
    const missing = toComparisonState(null, "nothing ran");
    expect(observed.status).not.toBe(missing.status);
    expect("comparison" in observed).toBe(true);
    expect("comparison" in missing).toBe(false);
    expect("reason" in missing).toBe(true);
  });
});

describe("malformed input from an untyped producer", () => {
  it("returns problems rather than throwing on a bundle that is not an object", () => {
    // Every producer of these artifacts is an untyped `.mjs` script. Reading
    // fields off a typed parameter meant a malformed artifact threw a TypeError
    // out of the validator — the exact failure `validateEvent` takes `unknown`
    // to prevent.
    for (const candidate of [null, undefined, 42, "a bundle", []]) {
      expect(() => validateBundle(candidate)).not.toThrow();
      expect(validateBundle(candidate).length).toBeGreaterThan(0);
    }
  });

  it("returns problems rather than throwing when deltas is missing entirely", () => {
    const { deltas, ...withoutDeltas } = comparison();
    void deltas;
    const candidate = { bundleVersion: JUDGE_RUN_BUNDLE_VERSION, event, comparison: withoutDeltas };
    expect(() => validateBundle(candidate)).not.toThrow();
    expect(validateBundle(candidate).join(" ")).toMatch(/deltas/);
  });

  it("returns problems rather than throwing when a plan's steps are not an array", () => {
    const base = comparison();
    const candidate = {
      bundleVersion: JUDGE_RUN_BUNDLE_VERSION,
      event,
      comparison: { ...base, joinedPlan: { ...base.joinedPlan, steps: "two of them" } },
    };
    expect(() => validateBundle(candidate)).not.toThrow();
    expect(validateBundle(candidate).length).toBeGreaterThan(0);
  });

  it("refuses an unknown key rather than carrying it into the artifact", () => {
    const candidate = {
      bundleVersion: JUDGE_RUN_BUNDLE_VERSION,
      event,
      comparison: { ...comparison(), confidence: 0.8 },
    };
    expect(validateBundle(candidate).join(" ")).toMatch(/confidence|unrecognized/i);
  });

  it("reports shape problems alone, without a cascade of invariant consequences", () => {
    // Running the invariant checks over an object that failed its shape reports
    // consequences and buries the cause.
    const problems = validateBundle({ bundleVersion: "9.9", event, comparison: comparison() });
    expect(problems.every((problem) => !problem.startsWith("event:"))).toBe(true);
  });
});

describe("the bundled event must itself be valid", () => {
  it("refuses a bundle whose event does not validate", () => {
    // The digest proves the comparison came from *this* event. It says nothing
    // about whether this event is one anybody should reason from — an event
    // whose accounting does not reconcile digests perfectly well.
    const broken = JSON.parse(JSON.stringify(event)) as ChangeImpactEvent;
    broken.accounting.datasetsResolved = 99;
    const problems = validateBundle({
      bundleVersion: JUDGE_RUN_BUNDLE_VERSION,
      event: broken,
      comparison: comparison({ eventDigest: digestEvent(broken) }),
    });
    expect(problems.some((problem) => problem.startsWith("event:"))).toBe(true);
  });

  it("does not present a bundle with an invalid event as observed", () => {
    const broken = JSON.parse(JSON.stringify(event)) as ChangeImpactEvent;
    broken.accounting.datasetsResolved = 99;
    const state = toComparisonState(
      {
        bundleVersion: JUDGE_RUN_BUNDLE_VERSION,
        event: broken,
        comparison: comparison({ eventDigest: digestEvent(broken) }),
      },
      "unused",
    );
    expect(state.status).toBe("unavailable");
  });
});

describe("an event with no corpus identity", () => {
  it("says the identity is missing rather than reporting a snapshot mismatch", () => {
    // The snapshot's repository and revision are non-null by design: a delta
    // attributed to code nobody can name is not something a judge can check.
    // But the event's corpus fields are nullable, so a plain `!==` reported
    // "does not match" for an event that simply never knew its corpus — a true
    // statement about the wrong problem.
    const anonymous = JSON.parse(JSON.stringify(event)) as ChangeImpactEvent;
    anonymous.provenance.corpus = { repository: null, commit: null };
    const problems = validateBundle({
      bundleVersion: JUDGE_RUN_BUNDLE_VERSION,
      event: anonymous,
      comparison: comparison({ eventDigest: digestEvent(anonymous) }),
    });
    expect(problems.join(" ")).toMatch(/carries no corpus identity/);
    expect(problems.join(" ")).not.toMatch(/snapshot\.repository does not match/);
  });
});

describe("structural refusals", () => {
  it("refuses a plan with no steps", () => {
    const base = comparison();
    const problems = validateBundle({
      ...bundle(),
      comparison: { ...base, datahubOnlyPlan: { ...base.datahubOnlyPlan, steps: [] } },
    });
    expect(problems.join(" ")).toMatch(/has no steps/);
  });

  it("refuses duplicate step ids, which would make a reordering ambiguous", () => {
    const base = comparison();
    const problems = validateBundle({
      ...bundle(),
      comparison: {
        ...base,
        joinedPlan: {
          ...base.joinedPlan,
          steps: [
            { id: "s1", action: "edit the model" },
            { id: "s1", action: "run the build" },
          ],
        },
      },
    });
    expect(problems.join(" ")).toMatch(/is not unique within the plan/);
  });

  it("refuses plans whose modes are swapped", () => {
    const base = comparison();
    const problems = validateBundle({
      ...bundle(),
      comparison: {
        ...base,
        datahubOnlyPlan: { ...base.datahubOnlyPlan, mode: "joined" },
        joinedPlan: { ...base.joinedPlan, mode: "datahub-only" },
      },
    });
    expect(problems.join(" ")).toMatch(/datahubOnlyPlan\.mode is joined/);
    expect(problems.join(" ")).toMatch(/joinedPlan\.mode is datahub-only/);
  });

  it("refuses a snapshot describing a different corpus than the event", () => {
    const base = comparison();
    const problems = validateBundle({
      ...bundle(),
      comparison: { ...base, snapshot: { ...base.snapshot, revision: "0000000000000000000000000000000000000000" } },
    });
    expect(problems.join(" ")).toMatch(/snapshot\.revision does not match/);
  });

  it("reports every problem at once rather than the first", () => {
    const base = comparison();
    const problems = validateBundle({
      ...bundle(),
      comparison: {
        ...base,
        eventDigest: "sha256:wrong",
        joinedPlan: { ...base.joinedPlan, run: { ...RUN, model: "other" }, steps: [] },
      },
    });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});
