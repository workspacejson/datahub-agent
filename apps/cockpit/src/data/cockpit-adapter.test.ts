import { describe, expect, it } from "vitest";
import { createAdapter, fixtureLiveParity, provisionalAdapter, provisionalStateAdapter } from "./cockpit-adapter";
import { cockpitViewModelSchema } from "../model/cockpit-view-model";

describe("CockpitViewModel boundary", () => {
  it("marks the entire provisional model placeholder", () => expect(provisionalAdapter.read().sourceMode).toBe("placeholder"));
  it("refuses an invalid source axis rather than inferring a status", () => {
    expect(() => cockpitViewModelSchema.parse({ ...provisionalAdapter.read(), sourceMode: "live", source: "verified" })).toThrow();
  });
  it("keeps fixture and live parity while excluding sourceMode", () => {
    const event = provisionalStateAdapter("partial").read();
    const fixture = createAdapter(event, "fixture").read();
    const live = createAdapter(event, "live").read();
    expect(fixtureLiveParity(fixture, live)).toBe(true);
    expect(fixtureLiveParity(fixture, { ...live, read: "failed" })).toBe(false);
  });
  it("refuses unsupported writeback success claims", () => {
    expect(() => cockpitViewModelSchema.parse({
      ...provisionalStateAdapter("success").read(), intendedStateObservation: "not-observed",
    })).toThrow();
  });
  it("normalizes every required harness state as a whole placeholder model", () => {
    for (const state of ["loading", "unavailable", "partial", "contradictory", "error", "accepted-not-observed", "success"] as const) {
      expect(provisionalStateAdapter(state).read().sourceMode).toBe("placeholder");
    }
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
