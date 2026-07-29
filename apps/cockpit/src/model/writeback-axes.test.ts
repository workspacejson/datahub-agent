import { describe, expect, it } from "vitest";

import { writebackAxes } from "./writeback-axes";

/** A receipt in the shape HAC-149 emits, with only the axis-bearing fields. */
function receipt(over: Record<string, unknown> = {}) {
  return {
    intended: { linkUrl: null, evidenceTier: "VERIFIED" },
    before: { linkUrl: null, evidenceTier: null, read: "ok", readError: null },
    after: { linkUrl: null, evidenceTier: "VERIFIED", read: "ok", readError: null },
    attempts: [{ mutation: "upsertStructuredProperties", succeeded: true }],
    observation: { status: "settled", polls: 1, elapsedMs: 10, timeoutMs: 120000, lastError: null },
    succeeded: true,
    noop: false,
    bothStatesRead: true,
    ...over,
  };
}

describe("deriving the writeback axes from a receipt", () => {
  it("reports nothing attempted when no receipt is attached", () => {
    // An absent writeback is not a failed one. The terminal question does not
    // arise, and answering it anyway would be inventing an outcome.
    const axes = writebackAxes(undefined);
    expect(axes.mutationAcceptance).toBe("not-attempted");
    expect(axes.terminalWritebackDisposition).toBe("not-applicable");
    expect(axes.receipt.afterStateFreshness).toBe("not-read");
  });

  it("reports success only when the mutation was accepted and intent was observed", () => {
    const axes = writebackAxes(receipt());
    expect(axes.mutationAcceptance).toBe("accepted");
    expect(axes.intendedStateObservation).toBe("observed");
    expect(axes.terminalWritebackDisposition).toBe("success");
    expect(axes.receipt.afterStateFreshness).toBe("fresh");
  });

  it("holds accepted-not-observed apart from success when the after-state timed out", () => {
    // HAC-217's mandatory terminal state, and the distinction the whole trust
    // surface turns on: the mutation was acknowledged and the intended state was
    // never seen. A surface reporting this as success would be claiming a write
    // it cannot demonstrate.
    const axes = writebackAxes(receipt({
      observation: { status: "timed-out", polls: 12, elapsedMs: 120000, timeoutMs: 120000, lastError: null },
      succeeded: false,
    }));
    expect(axes.mutationAcceptance).toBe("accepted");
    expect(axes.intendedStateObservation).toBe("not-observed");
    expect(axes.terminalWritebackDisposition).toBe("accepted-not-observed");
  });

  it("calls a successful read showing the wrong value stale, not unread", () => {
    // The read completed. That is `ok`. It just did not show intent, which is a
    // different axis — collapsing the two would lose the distinction exactly
    // where it matters.
    const axes = writebackAxes(receipt({
      observation: { status: "timed-out", polls: 12, elapsedMs: 120000, timeoutMs: 120000, lastError: null },
      succeeded: false,
    }));
    expect(axes.receipt.afterStateRead).toBe("ok");
    expect(axes.receipt.afterStateFreshness).toBe("stale");
  });

  it("keeps a noop out of both success and failure", () => {
    // The catalog already held the intended values. Reporting success would
    // claim a change that did not happen; reporting failure would claim a fault
    // that did not occur.
    const axes = writebackAxes(receipt({ noop: true, succeeded: false }));
    expect(axes.terminalWritebackDisposition).toBe("noop");
  });

  it("reports a rejected mutation as failed rather than unobserved", () => {
    const axes = writebackAxes(receipt({
      attempts: [{ mutation: "upsertStructuredProperties", succeeded: false }],
      succeeded: false,
    }));
    expect(axes.mutationAcceptance).toBe("rejected");
    expect(axes.terminalWritebackDisposition).toBe("failed");
  });

  it("refuses to pick a side when the receipt contradicts itself", () => {
    // Every mutation accepted and intent observed, but the producer's own
    // conjunction says otherwise. Two sources disagree about the same fact, and
    // reporting either as the answer would be choosing one arbitrarily.
    const axes = writebackAxes(receipt({ succeeded: false }));
    expect(axes.terminalWritebackDisposition).toBe("contradictory");
  });

  it("states an unreadable receipt as indeterminate rather than as absent", () => {
    // A receipt that cannot be parsed is not a missing one. Reporting
    // `not-attempted` would claim knowledge about something unread.
    const axes = writebackAxes({ attempts: "not an array" });
    expect(axes.terminalWritebackDisposition).toBe("indeterminate");
    expect(axes.indeterminateBecause).toContain("does not carry the fields");
  });

  it("keeps the receipt block and the top-level axes identical by construction", () => {
    // The view model asserts these match. Deriving both from one read means they
    // cannot drift, so that invariant stays a check rather than the mechanism.
    for (const over of [{}, { noop: true }, { succeeded: false }, { attempts: [] }]) {
      const axes = writebackAxes(receipt(over));
      expect(axes.receipt.mutationResponse).toBe(axes.mutationAcceptance);
      expect(axes.receipt.intendedStateObservation).toBe(axes.intendedStateObservation);
      expect(axes.receipt.terminalDisposition).toBe(axes.terminalWritebackDisposition);
    }
  });

  it("says why a state is missing instead of rendering an empty one", () => {
    const axes = writebackAxes(receipt({ before: { read: "failed", readError: "connection reset" } }));
    expect(axes.receipt.beforeState).toEqual({
      state: "unavailable",
      reason: "The state read failed: connection reset.",
    });
  });
});
