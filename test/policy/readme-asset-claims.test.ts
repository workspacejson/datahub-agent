import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The README diagrams must agree with the evidence they cite.
 *
 * A diagram is the one artifact that can drift from its source silently. Nothing
 * imports it, no type refers to it, and a number typed into it by hand is
 * indistinguishable from a number derived from a run. The risk is specific and
 * asymmetric: a stale count on a marketing image is a false claim about a fixed
 * experiment, and the experiment cannot be reworded to match afterwards.
 *
 * So the strings that carry claims are asserted against the files that produced
 * them, not against each other. `evaluation/hac-150/manifest.json` owns the
 * subject, `aggregate.json` owns the measures, and the SVG is checked to quote
 * both. If HAC-150 is ever re-run and its numbers move, this fails and the
 * diagram gets updated rather than quietly disagreeing with its own receipt.
 *
 * This is the same defect class as the stale `pairedSpread` absence: a surface
 * that exists to establish trust, asserting something no longer true, in the
 * direction that looks fine.
 */

const root = resolve(process.cwd());
const svgPath = "assets/exports/readme-context-gap-1200x780/readme-context-gap-1200x780.svg";

const svg = readFileSync(resolve(root, svgPath), "utf8");
const manifest = JSON.parse(readFileSync(resolve(root, "evaluation/hac-150/manifest.json"), "utf8"));
const aggregate = JSON.parse(readFileSync(resolve(root, "evaluation/hac-150/aggregate.json"), "utf8"));

/** The SVG minus its comments: what a reader actually sees. */
const rendered = svg.replace(/<!--[\s\S]*?-->/g, "");

describe("the context-gap diagram quotes the evidence it cites", () => {
  it("names the subject's exact source, character for character", () => {
    // Not a lookalike path. The whole point of the diagram is that this string
    // is the one the join resolved, so an approximation of it is a different
    // claim wearing the same shape.
    expect(rendered).toContain(manifest.subject.exactSource);
  });

  it("names the subject's pinned revision in full, not an abbreviation", () => {
    // The full 40 characters. A shortened revision in a diagram invites a reader
    // to check the wrong commit, and "close enough" is not a property a pinned
    // revision has.
    expect(rendered).toContain(manifest.subject.exactRevision);
    expect(manifest.subject.exactRevision).toHaveLength(40);
  });

  it("states the joined-context result with the measured denominator", () => {
    const measure = aggregate.measures.exactRevisionOnlyInJoined;
    expect(rendered).toContain(`${measure.count}/${measure.denominator}`);
  });

  it("states the DataHub-only result as the complement, on the same denominator", () => {
    /*
      `exactRevisionOnlyInJoined` counts pairs where the joined plan carried the
      exact revision and the DataHub-only plan did not. When that count equals
      the denominator, DataHub-only carried it in none of them, which is what the
      diagram's 0/10 asserts. Derived here rather than typed, so the two numbers
      cannot drift apart.
    */
    const measure = aggregate.measures.exactRevisionOnlyInJoined;
    const datahubOnly = measure.denominator - measure.count;
    expect(rendered).toContain(`${datahubOnly}/${measure.denominator}`);
  });

  it("uses the pairs requested as the denominator, never the pairs that conformed", () => {
    // The evaluation's own rule: a failed run is reported as a failure, never
    // excluded from the denominator. A diagram quoting a conformer-only
    // denominator would launder that.
    expect(aggregate.measures.exactRevisionOnlyInJoined.denominator).toBe(aggregate.pairsRequested);
  });

  it("would catch a number edited out of agreement with the evaluation", () => {
    // The detector. Every assertion above is `toContain`, which passes on a
    // superset: a diagram containing both the right and the wrong number would
    // satisfy them. This checks the inverse direction, that a count the
    // evaluation does not support is absent.
    const measure = aggregate.measures.exactRevisionOnlyInJoined;
    const wrong = `${measure.count - 1}/${measure.denominator}`;
    expect(rendered).not.toContain(wrong);
  });
});

describe("the context-gap diagram keeps the encodings that carry meaning", () => {
  it("never uses the danger colour", () => {
    // A refusal under insufficient identity is a correct outcome, not a fault.
    // Red would make the left column read as a broken system, which is the
    // opposite of the integrity claim the diagram exists to support.
    expect(rendered).not.toContain("f2545b");
  });

  it("spends emerald only on workspace.json attribution", () => {
    /*
      Emerald is reserved for `workspace.json` attribution and primary actions.
      Letting it carry resolution meaning would make "resolved" read as "we
      generated this". Two occurrences, both on the attribution chip: its stroke
      and its label.
    */
    const occurrences = rendered.match(/00c896/g) ?? [];
    expect(occurrences).toHaveLength(2);
    expect(rendered).toMatch(/stroke="#00c896"[\s\S]{0,200}workspace\.json/);
  });

  it("names every state in words, so the diagram survives greyscale", () => {
    // Colour reinforces; shape and the literal word carry the meaning. Each of
    // these is the readable form of a state that is also encoded visually.
    for (const word of ["Unavailable", "Insufficient context", "Coverage: not established", "Refuse"]) {
      expect(rendered).toContain(word);
    }
  });

  it("carries a text alternative that states the finding, not just the layout", () => {
    const description = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(svg)?.[1] ?? "";
    expect(description).toContain(manifest.subject.exactSource);
    expect(description.length).toBeGreaterThan(200);
  });

  it("holds no em dash and no pictograph in rendered text", () => {
    // The house copy rules, which apply wherever a reader meets the words.
    const text = [...rendered.matchAll(/>([^<>]+)</g)].map((m) => m[1]).join(" ");
    expect(text).not.toContain("—");
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
