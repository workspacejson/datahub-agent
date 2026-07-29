/**
 * The producer's unresolved-reason vocabulary, and the guard that it stays total.
 *
 * `accounting.unresolvedRecords[].reason` is free text in the contract on
 * purpose — HAC-267 declined to freeze a taxonomy before any run showed which
 * dispositions actually occur. This project has one producer, so the vocabulary
 * is constrained here instead, where changing it costs nothing.
 *
 * The test worth having is the last one. It reads the contract's own list of
 * dispositions rather than a copy, so adding a seventh disposition without
 * giving it a reason fails here instead of shipping an event whose unresolved
 * record says `undefined`.
 */

import { describe, expect, it } from "vitest";

import { WORKSPACE_INTEGRITY_VALUES, type WorkspaceIntegrity } from "../../src/integration/change-impact-event.js";
import { UNRESOLVED_REASONS, unresolvedReasonFor, unresolvedRecordsFor } from "../../src/integration/unresolved-records.js";

const URN = "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)";
const NOT_RESOLVING = WORKSPACE_INTEGRITY_VALUES.filter((value) => value !== "exact-match");

describe("the unresolved-reason vocabulary", () => {
  it("gives a reason for every disposition that did not resolve", () => {
    for (const integrity of NOT_RESOLVING) {
      expect(unresolvedReasonFor(integrity).length).toBeGreaterThan(0);
    }
  });

  it("refuses exact-match, because a resolved dataset has no unresolved reason", () => {
    expect(() => unresolvedReasonFor("exact-match")).toThrow(/no unresolved reason/);
  });

  it("states why the dataset fell outside the candidate set, not merely that it did", () => {
    // HAC-217's gate asks for scope establishment. A reason that only repeats
    // "unresolved" would satisfy the type and fail the gate, so each entry has
    // to name the thing that was wrong — artifact, repository, revision, index
    // or ambiguity.
    for (const integrity of NOT_RESOLVING) {
      const reason = unresolvedReasonFor(integrity);
      expect(reason).toMatch(/artifact|repository|revision|file index|file-index|more than one/i);
      expect(reason).not.toBe("unresolved");
    }
  });

  it("names distinct causes distinctly, so two dispositions never read the same", () => {
    const reasons = NOT_RESOLVING.map((integrity) => unresolvedReasonFor(integrity));
    expect(new Set(reasons).size).toBe(reasons.length);
  });
});

describe("unresolvedRecordsFor", () => {
  it("attaches no record to a dataset that resolved", () => {
    expect(unresolvedRecordsFor(URN, "exact-match")).toEqual([]);
  });

  it("names the subject that was asked for, rather than deriving a name", () => {
    // The point of the field is that names are observed, not invented. For a
    // single-subject emit the unresolved dataset is the URN the caller passed,
    // and nothing else could be correct.
    for (const integrity of NOT_RESOLVING) {
      const records = unresolvedRecordsFor(URN, integrity);
      expect(records).toHaveLength(1);
      expect(records[0]!.urn).toBe(URN);
      expect(records[0]!.reason).toBe(UNRESOLVED_REASONS[integrity]);
    }
  });

  it("produces exactly one record per unresolved dataset, matching the count the emitter reports", () => {
    // The contract rejects a list whose length disagrees with
    // `datasetsUnresolved`. The emitter reports 1 unresolved exactly when the
    // disposition is not exact-match, so this is that equality at the source.
    for (const integrity of WORKSPACE_INTEGRITY_VALUES) {
      const expected = integrity === "exact-match" ? 0 : 1;
      expect(unresolvedRecordsFor(URN, integrity)).toHaveLength(expected);
    }
  });
});

describe("the vocabulary stays total as the contract changes", () => {
  it("covers every non-resolving disposition the contract admits, read from the contract", () => {
    // Reads WORKSPACE_INTEGRITY_VALUES rather than a list written here. A
    // seventh disposition added to the contract without a reason fails this,
    // instead of emitting a record whose reason is undefined.
    const documented = Object.keys(UNRESOLVED_REASONS).sort();
    expect(documented).toEqual([...NOT_RESOLVING].sort());
  });

  it("documents no reason for a disposition the contract does not admit", () => {
    for (const key of Object.keys(UNRESOLVED_REASONS)) {
      expect(WORKSPACE_INTEGRITY_VALUES).toContain(key as WorkspaceIntegrity);
    }
  });
});
