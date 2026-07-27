import { describe, expect, it } from "vitest";
import { createAdapter, fixtureLiveParity, provisionalAdapter } from "./cockpit-adapter";
import { cockpitViewModelSchema } from "../model/cockpit-view-model";

const event = {
  route: "impact", source: "DataHub", read: "ok", completeness: "not-established", resolutionDisposition: "unavailable",
  mutationAcceptance: "not-attempted", intendedStateObservation: "not-attempted", terminalWritebackDisposition: "not-applicable",
  title: "Live model", summary: "Bound via adapter", unresolvedItems: [],
};

describe("CockpitViewModel boundary", () => {
  it("marks the entire provisional model placeholder", () => expect(provisionalAdapter.read().sourceMode).toBe("placeholder"));
  it("refuses an invalid source axis rather than inferring a status", () => {
    expect(() => cockpitViewModelSchema.parse({ ...event, sourceMode: "live", source: "verified" })).toThrow();
  });
  it("keeps fixture and live parity while excluding sourceMode", () => {
    const fixture = createAdapter(event, "fixture").read();
    const live = createAdapter(event, "live").read();
    expect(fixtureLiveParity(fixture, live)).toBe(true);
    expect(fixtureLiveParity(fixture, { ...live, read: "failed" })).toBe(false);
  });
});
