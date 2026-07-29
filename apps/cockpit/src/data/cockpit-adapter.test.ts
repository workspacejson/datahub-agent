import { describe, expect, it } from "vitest";
import { createAdapter, fixtureLiveParity, provisionalAdapter, provisionalStateAdapter } from "./cockpit-adapter";
import { createComparisonAdapter } from "./comparison-adapter";
import { cockpitViewModelSchema } from "../model/cockpit-view-model";
import { contractEvent } from "../test/contract-event";
import { judgeRunBundle } from "../test/judge-run-bundle";

describe("CockpitViewModel boundary", () => {
  it("marks the entire provisional model placeholder", () => expect(provisionalAdapter.read().sourceMode).toBe("placeholder"));
  it("refuses an invalid source axis rather than inferring a status", () => {
    expect(() => cockpitViewModelSchema.parse({ ...provisionalAdapter.read(), sourceMode: "live", source: "verified" })).toThrow();
  });
  it("keeps fixture and live parity while excluding sourceMode", () => {
    // Both modes now take a `ChangeImpactEvent`, not a view model. This test
    // used to hand `createAdapter` the output of another adapter, which the
    // `as SourceEvent` cast accepted — so it asserted parity between two
    // projections of something that was never an event.
    const event = contractEvent();
    const fixture = createAdapter(event, "fixture").read();
    const live = createAdapter(event, "live").read();
    expect(fixtureLiveParity(fixture, live)).toBe(true);
    expect(fixtureLiveParity(fixture, { ...live, read: "failed" })).toBe(false);
  });

  it("normalizes a bundle into a model carrying its observed comparison", () => {
    const event = contractEvent();
    const model = createComparisonAdapter(judgeRunBundle(event), "live").read();
    expect(model.sourceMode).toBe("live");
    expect(model.planComparison.state).toBe("observed");
    expect(cockpitViewModelSchema.safeParse(model).success).toBe(true);
  });

  it("throws on a malformed event in a bundle, but not on a malformed comparison", () => {
    // The asymmetry, at the adapter boundary: a bad event has no view, while a
    // bad comparison is a state the view can show. Collapsing these would either
    // crash away a diagnosis or render a partial artifact as a confident one.
    const bundle = judgeRunBundle(contractEvent());
    expect(() => createComparisonAdapter({ ...bundle, event: { eventVersion: "1.3" } }, "live"))
      .toThrow(/does not satisfy the change-impact contract/);

    const model = createComparisonAdapter({ ...bundle, comparison: { ...bundle.comparison, eventDigest: "sha256:wrong" } }, "live").read();
    expect(model.planComparison.state).toBe("unavailable");
  });

  it("refuses a view model where an event belongs, instead of casting it", () => {
    // The regression the cast permitted: anything shaped roughly right slid
    // through, including a model that had already been projected once.
    const alreadyProjected = provisionalStateAdapter("partial").read();
    expect(() => createAdapter(alreadyProjected, "live")).toThrow(/does not satisfy the change-impact contract/);
  });
  it("refuses unsupported writeback success claims", () => {
    expect(() => cockpitViewModelSchema.parse({
      ...provisionalStateAdapter("success").read(), intendedStateObservation: "not-observed",
    })).toThrow();
  });
  it("normalizes every required harness state as a whole placeholder model", () => {
    for (const state of ["loading", "unavailable", "partial", "ambiguous", "indeterminate", "contradictory", "error", "accepted-not-observed", "success"] as const) {
      expect(provisionalStateAdapter(state).read().sourceMode).toBe("placeholder");
    }
  });
  it("rejects accounting, unresolved-list, stale-read, noop, and cross-field writeback violations", () => {
    const model = provisionalStateAdapter("partial").read();
    const withReceipt = (receipt: Record<string, unknown>, rest: Record<string, unknown> = {}) =>
      ({ ...model, receipt: { ...model.receipt, ...receipt }, ...rest });

    // R-3 — the dataset denominator must reconcile on its own terms. Node
    // counts are a different denominator and are never folded in.
    expect(() => cockpitViewModelSchema.parse(withReceipt({
      accounting: { ...model.receipt.accounting, datasetsRequested: 2 },
    }))).toThrow();
    // Adding a dropped node cannot repair a dataset imbalance, because the two
    // are not the same count — this is the mixed-vocabulary defect, asserted.
    expect(() => cockpitViewModelSchema.parse(withReceipt({
      accounting: { ...model.receipt.accounting, datasetsRequested: 2, nodesDropped: 1 },
    }))).toThrow();

    // R-5 — an unresolved count with no matching named list.
    expect(() => cockpitViewModelSchema.parse(withReceipt({
      unresolvedDatasets: { state: "observed", names: [] },
    }))).toThrow();

    // A stated gap that no longer matches what the strip shows.
    expect(() => cockpitViewModelSchema.parse(withReceipt({ statedGaps: [] }))).toThrow();

    // R-6 — a stale after-state is not success, even with every other axis set.
    expect(() => cockpitViewModelSchema.parse(withReceipt(
      { writeback: { ...model.receipt.writeback, mutationResponse: "accepted", terminalDisposition: "success", intendedStateObservation: "observed", afterStateRead: "ok", bothStatesRead: true, afterStateFreshness: "stale" } },
      { mutationAcceptance: "accepted", intendedStateObservation: "observed", terminalWritebackDisposition: "success" },
    ))).toThrow();

    // `noop` is intent-relative: it is only sayable when the before-state and
    // the intent are the same observation.
    expect(() => cockpitViewModelSchema.parse(withReceipt(
      { writeback: { ...model.receipt.writeback, terminalDisposition: "noop", intent: { state: "observed", value: "tier VERIFIED", source: "Joined" }, beforeState: { state: "observed", value: "tier OBSERVED", source: "DataHub" } } },
      { terminalWritebackDisposition: "noop" },
    ))).toThrow();

    // The writeback axes on the strip and in the receipt cannot disagree.
    expect(() => cockpitViewModelSchema.parse({ ...model, mutationAcceptance: "accepted" })).toThrow();
  });

  it("refuses placeholder evidence in any build that is not a placeholder build", () => {
    // R-4. The placeholder banner is a render convention; this is the boundary.
    // A fixture or live model carrying an invented value is rejected by name,
    // regardless of which adapter produced it.
    const placeholder = provisionalStateAdapter("partial").read();
    expect(placeholder.receipt.provenance.subjectRepository.state).toBe("placeholder");

    for (const sourceMode of ["fixture", "live"] as const) {
      expect(() => cockpitViewModelSchema.parse({ ...placeholder, sourceMode }))
        .toThrow(/placeholder receipt value/);
    }
    // And the same model is accepted in the mode that is allowed to hold it.
    expect(cockpitViewModelSchema.parse(placeholder).sourceMode).toBe("placeholder");
  });
  it("rejects impossible read, completeness, and resolution combinations", () => {
    const model = provisionalStateAdapter("partial").read();
    expect(() => cockpitViewModelSchema.parse({ ...model, read: "failed", completeness: "complete-against-pinned-manifest" })).toThrow();
    // `exact`, not the retired `resolved`.
    //
    // These two assert cross-field refinements — a failed read cannot resolve a
    // source, an unavailable source cannot be resolved. When the axis was
    // renamed they kept saying `resolved`, so they still threw, but at the enum
    // stage: the value was simply no longer a member. Both refinements went
    // untested and neither could be killed by mutation, while the tests named
    // for them stayed green.
    //
    // A test that passes for a different reason than the one it was written for
    // is worse than a missing test, because it reports coverage that is not
    // there. The refusal messages are asserted here so this cannot recur
    // silently — a rule that stops firing now changes the message, not just the
    // fact of throwing.
    expect(() => cockpitViewModelSchema.parse({ ...model, read: "failed", resolutionDisposition: "exact" }))
      .toThrow(/A failed read cannot resolve a source/);
    expect(() => cockpitViewModelSchema.parse({ ...model, source: "unavailable", resolutionDisposition: "exact" }))
      .toThrow(/An unavailable source cannot be resolved/);
    // A source that could not be consulted cannot report that it answered.
    expect(() => cockpitViewModelSchema.parse({ ...model, source: "unavailable", read: "ok" }))
      .toThrow(/An unavailable source cannot report a successful read/);
  });

  it("refuses a receipt whose bothStatesRead contradicts the after-state it read", () => {
    // A HAC-146 invariant that was enforced in code and killed by no test — so
    // a refactor could have removed it silently. Found by mutation-sweeping
    // every refinement in this schema during the HAC-146 closure read-back.
    //
    // Both directions, because the field is a claim either way: asserting the
    // states were read when the after-state was not, and denying it when it was.
    const model = provisionalStateAdapter("partial").read();
    const writeback = model.receipt.writeback;

    expect(() => cockpitViewModelSchema.parse({
      ...model,
      receipt: { ...model.receipt, writeback: { ...writeback, afterStateRead: "failed", bothStatesRead: true } },
    })).toThrow(/bothStatesRead must exactly reflect a readable after-state/);

    expect(() => cockpitViewModelSchema.parse({
      ...model,
      receipt: { ...model.receipt, writeback: { ...writeback, afterStateRead: "ok", bothStatesRead: false } },
    })).toThrow(/bothStatesRead must exactly reflect a readable after-state/);
  });

  it("refuses a receipt claiming success without observing the intended state", () => {
    // The other unkilled HAC-146 invariant. `succeeded` requires the intended
    // state to have been observed — mutations returning cleanly is not evidence
    // that the write became visible, which is the defect HAC-223 fixed one
    // layer down and this rule mirrors at the surface.
    const model = provisionalStateAdapter("success").read();
    const writeback = model.receipt.writeback;

    expect(() => cockpitViewModelSchema.parse({
      ...model,
      receipt: {
        ...model.receipt,
        writeback: { ...writeback, intendedStateObservation: "not-observed", terminalDisposition: "success" },
      },
    })).toThrow(/Success requires observed intended state/);
  });
  it("models matched, mismatched, ambiguous, and unavailable resolution without inference", () => {
    // This test was already named for `ambiguous` while asserting `partial` —
    // the collapse, visible in the test's own title. All five ratified values
    // are exercised now, so the axis cannot quietly shrink again.
    const model = provisionalStateAdapter("partial").read();
    for (const disposition of ["exact", "ambiguous", "mismatch", "indeterminate"] as const) {
      expect(cockpitViewModelSchema.parse({ ...model, resolutionDisposition: disposition }).resolutionDisposition).toBe(disposition);
    }
    expect(cockpitViewModelSchema.parse({ ...model, source: "unavailable", read: "not-queried", resolutionDisposition: "unavailable" }).resolutionDisposition).toBe("unavailable");
    // `partial` is gone. An event still carrying it is refused rather than
    // silently coerced to the nearest surviving value.
    expect(() => cockpitViewModelSchema.parse({ ...model, resolutionDisposition: "partial" })).toThrow();
    expect(() => cockpitViewModelSchema.parse({ ...model, resolutionDisposition: "resolved" })).toThrow();
  });
});
