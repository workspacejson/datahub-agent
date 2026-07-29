/**
 * The adapter swap, both halves.
 *
 * This module had no test at all while it was the thing deciding whether the
 * cockpit could render real evidence. It threw for every non-placeholder mode,
 * which reads as a guard and was actually the missing swap — so "fixture mode
 * doesn't work" and "fixture mode is correctly refused" were indistinguishable
 * from the outside.
 */

import { describe, expect, it } from "vitest";

import { contractEvent } from "../test/contract-event";

import { selectCockpitAdapter } from "./select-adapter";

/**
 * The committed judge package itself, not a rebuilt approximation of it, so this
 * exercises the artifact a fixture build would actually bundle.
 */
import nested from "../../../../test/fixtures/golden/change-impact-event.nested.json";

describe("choosing what the cockpit renders", () => {
  it("renders invented values only in a placeholder build", () => {
    expect(selectCockpitAdapter("placeholder").read().sourceMode).toBe("placeholder");
  });

  it("renders the committed judge package in fixture mode", () => {
    // The half that did not work. Before the swap this threw.
    const model = selectCockpitAdapter("fixture", nested).read();
    expect(model.sourceMode).toBe("fixture");
    expect(model.datasetIdentity.text.length).toBeGreaterThan(0);
  });

  it("renders the same package in live mode, differing only in how it says it was sourced", () => {
    // `fixtureLiveParity`'s premise, asserted rather than assumed: the two modes
    // are the same projection with a different label, so a judge comparing them
    // is comparing provenance and not content.
    const { sourceMode: fixtureMode, ...fixture } = selectCockpitAdapter("fixture", nested).read();
    const { sourceMode: liveMode, ...live } = selectCockpitAdapter("live", nested).read();
    expect(fixtureMode).toBe("fixture");
    expect(liveMode).toBe("live");
    expect(live).toEqual(fixture);
  });

  describe("placeholder cannot reach a judge", () => {
    it("never falls back to invented evidence when no event is bound", () => {
      // The failure that would matter: a fixture build silently degrading to the
      // provisional adapter and showing a judge values nobody observed. It
      // refuses instead, and says what to do.
      expect(() => selectCockpitAdapter("fixture", null)).toThrow(/no fallback evidence is invented/i);
      expect(() => selectCockpitAdapter("live", undefined)).toThrow(/renders a committed event and none was bound/);
    });

    it("never returns the provisional adapter outside placeholder mode", () => {
      const provisional = selectCockpitAdapter("placeholder").read();
      for (const mode of ["fixture", "live"] as const) {
        expect(selectCockpitAdapter(mode, nested).read()).not.toEqual(provisional);
      }
    });
  });

  it("refuses an event that fails the contract, rather than rendering it", () => {
    // Reaches `createAdapter` -> `readChangeImpactEvent`, which since HAC-242
    // runs the invariants as well as the schema. Two unresolved datasets, one
    // named: shaped correctly, and a claim the contract rejects.
    const invalid = contractEvent();
    invalid.accounting = {
      ...invalid.accounting,
      datasetsRequested: 3,
      datasetsResolved: 1,
      datasetsUnresolved: 2,
      unresolvedRecords: [
        { urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.a,PROD)", reason: "no producing node" },
      ],
    };
    expect(() => selectCockpitAdapter("fixture", invalid)).toThrow(/does not satisfy the change-impact contract/);
  });

  it("names the offending path when it refuses, so a build failure is diagnosable", () => {
    const malformed = contractEvent();
    delete (malformed as { subject?: unknown }).subject;
    expect(() => selectCockpitAdapter("fixture", malformed)).toThrow(/subject: is missing/);
  });
});
