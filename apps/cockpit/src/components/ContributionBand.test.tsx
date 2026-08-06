import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ContributionBand } from "./ContributionBand";
import { createAdapter } from "../data/cockpit-adapter";
import { contractEvent } from "../test/contract-event";
import { terminalWritebackDispositionSchema } from "../model/cockpit-view-model";
import type { CockpitViewModel, TerminalWritebackDisposition } from "../model/cockpit-view-model";

afterEach(cleanup);

const base = () => createAdapter(contractEvent(), "committed").read();

/**
 * The band summarises three contributions in three lines, and one of those lines
 * summarises the writeback.
 *
 * That is the cell with the most room to lie. The writeback axes are deliberately
 * separate in the contract — a mutation can be accepted without the intended
 * state ever being observed, and `accepted-not-observed` exists because the two
 * are different findings — and a one-line summary is exactly where they collapse
 * into "written". So every disposition is rendered and read back.
 */
function bandTextFor(disposition: TerminalWritebackDisposition): string {
  const model = base();
  /*
    The receipt is overridden directly rather than through the view-model schema.
    The schema cross-checks the writeback axes against each other, so most of
    these dispositions cannot be reached by editing one field — and the point
    here is what the *component* prints for a value it is handed, which is the
    thing that would flatten. The projection's own invariants are covered by
    `writeback-axes.test.ts` and the model refinement.
  */
  const withDisposition = {
    ...model,
    receipt: { ...model.receipt, writeback: { ...model.receipt.writeback, terminalDisposition: disposition } },
  } as CockpitViewModel;
  render(<ContributionBand model={withDisposition} />);
  const cell = screen.getByText("tally did").closest(".contribution");
  const text = cell?.textContent ?? "";
  cleanup();
  return text;
}

describe("the tally cell states the writeback without flattening it", () => {
  it("renders a distinct, non-empty phrase for every terminal disposition", () => {
    // A `Record` keyed on the enum makes a missing label a compile error; this
    // is the other half, that no two dispositions read the same to a reader.
    const seen = new Map<string, TerminalWritebackDisposition>();
    for (const disposition of terminalWritebackDispositionSchema.options) {
      const text = bandTextFor(disposition);
      expect(text, `${disposition} rendered no writeback line`).toContain("Writeback");
      const phrase = text.slice(text.indexOf("Writeback"));
      expect(phrase.length, `${disposition} rendered an empty phrase`).toBeGreaterThan("Writeback ".length);
      expect(seen.has(phrase), `${disposition} reads identically to ${seen.get(phrase)}`).toBe(false);
      seen.set(phrase, disposition);
    }
  });

  it("never claims a write happened when none was attempted", () => {
    const text = bandTextFor("not-applicable");
    expect(text).toContain("Writeback not attempted");
    // The sentence above the value must survive this state too: it says the two
    // coordinate systems were joined and the plans compared, both of which are
    // true regardless of whether anything was written.
    expect(text).toContain("Joined the two coordinate systems and compared the plans.");
    expect(text).not.toMatch(/wrote|written/i);
  });

  it("does not report acceptance as observation", () => {
    /*
      The state two fixtures exist for. DataHub accepted the mutation and the
      intended state was never observed on reread, which is not success — and a
      cell that said "written" or "observed" here would be asserting the
      observation the receipt explicitly withholds.
    */
    const text = bandTextFor("accepted-not-observed");
    expect(text).toContain("Writeback accepted, not observed");
    expect(text).not.toContain("observed in DataHub");
    expect(text).not.toMatch(/\bsuccess\b/i);
  });

  it("distinguishes the observed case from the accepted one", () => {
    // The pair that must not read alike. Success is the only one that may say
    // DataHub saw the intended state afterwards.
    expect(bandTextFor("success")).toContain("Writeback observed in DataHub on reread");
    expect(bandTextFor("noop")).toContain("Writeback already in the intended state");
    expect(bandTextFor("contradictory")).toContain("Writeback contradictory");
  });
});
