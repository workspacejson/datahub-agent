import { describe, expect, it } from "vitest";
import { createAdapter, fixtureLiveParity, provisionalAdapter, provisionalStateAdapter } from "./cockpit-adapter";
import { cockpitViewModelSchema } from "../model/cockpit-view-model";
import { contractEvent } from "../test/contract-event";

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
    for (const state of ["loading", "unavailable", "partial", "indeterminate", "contradictory", "error", "accepted-not-observed", "success"] as const) {
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
    expect(() => cockpitViewModelSchema.parse({ ...model, read: "failed", resolutionDisposition: "resolved" })).toThrow();
    expect(() => cockpitViewModelSchema.parse({ ...model, source: "unavailable", resolutionDisposition: "resolved" })).toThrow();
  });
  it("models matched, mismatched, ambiguous, and unavailable resolution without inference", () => {
    const model = provisionalStateAdapter("partial").read();
    expect(cockpitViewModelSchema.parse({ ...model, resolutionDisposition: "resolved" }).resolutionDisposition).toBe("resolved");
    expect(cockpitViewModelSchema.parse({ ...model, resolutionDisposition: "mismatch" }).resolutionDisposition).toBe("mismatch");
    expect(cockpitViewModelSchema.parse({ ...model, resolutionDisposition: "partial" }).resolutionDisposition).toBe("partial");
    expect(cockpitViewModelSchema.parse({ ...model, source: "unavailable", read: "not-queried", resolutionDisposition: "unavailable" }).resolutionDisposition).toBe("unavailable");
  });
});
