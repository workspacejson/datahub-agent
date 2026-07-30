/**
 * The frozen vocabulary, checked at the surface a judge actually reads.
 *
 * The contract tests hold the words in the event. These hold them in the
 * projection — the last place a strong word can appear unbounded, and the only
 * place a human sees one. A rename that stops at the type boundary would leave
 * the screen saying exactly what it said before.
 */

import { describe, expect, it } from "vitest";

import { createAdapter, fixtureLiveParity } from "../data/cockpit-adapter";
import { contractEvent } from "../test/contract-event";
import { projectEvent } from "./from-change-impact-event";

/** Every string anywhere in the projected model, however deeply nested. */
function stringLeaves(node: unknown, path = "$"): Array<[string, string]> {
  if (typeof node === "string") return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => stringLeaves(v, `${path}[${i}]`));
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) => stringLeaves(v, `${path}.${k}`));
  }
  return [];
}

describe("V-4 · no naked tier token reaches the rendered model", () => {
  const TIERS = ["ASSERTED", "OBSERVED", "VERIFIED"];

  it("never presents a tier without what produced it", () => {
    const model = projectEvent(contractEvent(), "receipts");
    // `rawEvidence` is the event verbatim — the bytes a reviewer checks every
    // other line against — so it necessarily contains the machine value and is
    // not a rendering of it. Excluding it is the one exception, and naming it
    // here is what keeps the exception deliberate.
    const leaves = stringLeaves(model).filter(([path]) => !path.endsWith("rawEvidence.value"));

    for (const [path, value] of leaves) {
      for (const tier of TIERS) {
        if (!value.includes(tier)) continue;
        // Wherever a tier appears in prose, the phrase that bounds it must
        // appear too. `describeTier` is the only sanctioned producer.
        expect(value, `${path} presents a bare ${tier}`).toMatch(
          new RegExp(`${tier}: .*record`),
        );
      }
    }
  });

  it("carries the bounded phrase on the summary a judge reads first", () => {
    const model = projectEvent(contractEvent(), "impact");
    expect(model.summary).toMatch(/(ASSERTED|OBSERVED|VERIFIED): .*record/);
  });

  it("would catch a summary reverted to the bare token", () => {
    // The detector, against a deliberately regressed string. Without this the
    // scan above passes on any model that happens to mention no tier at all.
    const model = projectEvent(contractEvent(), "impact");
    const regressed = { ...model, summary: "VERIFIED evidence from 3 record(s); 1 stated gap(s)." };
    const offending = stringLeaves(regressed)
      .filter(([path]) => !path.endsWith("rawEvidence.value"))
      .filter(([, v]) => TIERS.some((t) => v.includes(t) && !new RegExp(`${t}: .*record`).test(v)));
    expect(offending.length).toBeGreaterThan(0);
  });
});

describe("V-6 · fixture and live must not diverge beyond sourceMode", () => {
  const event = contractEvent();

  it("holds parity between the two modes for one event", () => {
    const fixture = createAdapter(event, "fixture").read();
    const live = createAdapter(event, "live").read();
    expect(fixture.sourceMode).toBe("fixture");
    expect(live.sourceMode).toBe("live");
    expect(fixtureLiveParity(fixture, live)).toBe(true);
  });

  it("notices a divergence on the completeness axis specifically", () => {
    // The axis this issue renamed. A parity check that ignored it would let the
    // fixture and the live read disagree about how far an answer can be trusted
    // — which is the one disagreement that changes what a judge concludes.
    const fixture = createAdapter(event, "fixture").read();
    const live = createAdapter(event, "live").read();
    expect(
      fixtureLiveParity(fixture, { ...live, completeness: "complete-against-pinned-manifest" }),
    ).toBe(false);
  });

  it("notices a divergence on the read axis", () => {
    const fixture = createAdapter(event, "fixture").read();
    const live = createAdapter(event, "live").read();
    expect(fixtureLiveParity(fixture, { ...live, read: "failed" })).toBe(false);
  });

  it("notices a divergence in the rendered summary, not only in the enums", () => {
    const fixture = createAdapter(event, "fixture").read();
    const live = createAdapter(event, "live").read();
    expect(fixtureLiveParity(fixture, { ...live, summary: "something else entirely" })).toBe(false);
  });
});
