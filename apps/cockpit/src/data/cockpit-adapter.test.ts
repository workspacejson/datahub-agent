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
    expect(() => cockpitViewModelSchema.parse({ ...model, receipt: { ...model.receipt, accounting: { ...model.receipt.accounting, total: 2 } } })).toThrow();
    expect(() => cockpitViewModelSchema.parse({ ...model, receipt: { ...model.receipt, unresolvedItems: [] } })).toThrow();
    expect(() => cockpitViewModelSchema.parse({ ...model, receipt: { ...model.receipt, writeback: { ...model.receipt.writeback, terminalDisposition: "success", intendedStateObservation: "observed", afterStateRead: "ok", bothStatesRead: true, afterStateFreshness: "stale" } }, intendedStateObservation: "observed", terminalWritebackDisposition: "success" })).toThrow();
    expect(() => cockpitViewModelSchema.parse({ ...model, receipt: { ...model.receipt, writeback: { ...model.receipt.writeback, terminalDisposition: "noop" } }, terminalWritebackDisposition: "noop" })).toThrow();
    expect(() => cockpitViewModelSchema.parse({ ...model, mutationAcceptance: "accepted" })).toThrow();
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
