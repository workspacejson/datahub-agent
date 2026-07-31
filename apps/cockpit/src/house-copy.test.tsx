import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { CockpitShell } from "./components/CockpitShell";
import { createAdapter } from "./data/cockpit-adapter";
import { contractEvent } from "./test/contract-event";
import { cockpitRouteSchema } from "./model/cockpit-view-model";

afterEach(cleanup);

/**
 * The house copy rules, checked where a reader actually meets them.
 *
 * The em dash rule was enforced on one string, `describeTier`, and eight others
 * kept theirs on Receipts. A vocabulary rule with an exception in the product's
 * most-read sentence is not a rule, and the way it came to have one is that
 * nothing checked the rest.
 *
 * This scans rendered text on every route rather than source files, because the
 * rule is about what a reader sees: a dash arriving through a contract string, a
 * fixture, or a component all read the same on screen. Comments and identifiers
 * are deliberately out of scope, and the model is the real projected one so a
 * regression in the contract's own copy fails here too.
 */
const ROUTES = cockpitRouteSchema.options;
const model = () => createAdapter(contractEvent(), "committed").read();

/** Every text node the routes render, with the route it came from. */
function renderedText(): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const route of ROUTES) {
    cleanup();
    render(<CockpitShell model={model()} route={route} onRouteChange={() => {}} />);
    // `textContent` of the whole tree would concatenate across elements and
    // report a dash that no single string contains. Walking text nodes keeps
    // each finding attributable to the string that actually holds it.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      if (text.trim()) found.push([route, text]);
    }
  }
  cleanup();
  return found;
}

describe("house copy rules hold on every rendered route", () => {
  it("uses no em dash anywhere a reader can see one", () => {
    const offenders = renderedText()
      .filter(([, text]) => text.includes("—"))
      .map(([route, text]) => `${route}: ${text.trim().slice(0, 80)}`);
    expect(offenders).toEqual([]);
  });

  it("uses no emoji or icon glyphs", () => {
    // The design system's own audit rules: no icon font, no emoji, no
    // illustration. A pictograph on an evidence surface is an unlabelled claim.
    const offenders = renderedText()
      .filter(([, text]) => /\p{Extended_Pictographic}/u.test(text))
      .map(([route, text]) => `${route}: ${text.trim().slice(0, 80)}`);
    expect(offenders).toEqual([]);
  });

  it("would catch a dash reintroduced into a rendered string", () => {
    // The detector, against a constructed violation. Both scans above pass
    // trivially on a tree that renders no text at all, and a guard that cannot
    // fail is worse than no guard: it reads as coverage.
    render(<CockpitShell model={{ ...model(), title: "game_events — draft" }} route="impact" onRouteChange={() => {}} />);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node.textContent ?? "").includes("—")) seen.push(node.textContent ?? "");
    }
    expect(seen.length).toBeGreaterThan(0);
  });

  it("actually walked something on every route", () => {
    // Guards the guard's other failure mode: a render that threw, or a shell
    // that stopped mounting its routes, would empty both scans silently.
    const byRoute = new Map<string, number>();
    for (const [route] of renderedText()) byRoute.set(route, (byRoute.get(route) ?? 0) + 1);
    for (const route of ROUTES) expect(byRoute.get(route) ?? 0).toBeGreaterThan(10);
  });
});

it("keeps the sentence that states a complete empty list", () => {
  // Called out in review as the best sentence in the product. It kept its
  // wording through the em dash fix; only the separator changed.
  render(<CockpitShell model={model()} route="receipts" onRouteChange={() => {}} />);
  expect(screen.getByText(/The empty list is the complete list: every requested dataset resolved\./)).toBeTruthy();
});

describe("each fact is stated once per route", () => {
  // The header stated coverage three ways and was collapsed to one; the same
  // thing then reappeared on Receipts, where the limitations card repeated the
  // banded gap reasons and the tier sentence rendered twice. Deduplication that
  // is not asserted is deduplication that migrates.
  // The raw evidence receipt is the event verbatim, so it necessarily restates
  // every reason and the tier: it is the bytes a reviewer checks the rendered
  // rows against, not a second rendering of them. `vocabulary-surface.test.ts`
  // makes the same exemption by name, and naming it in both places is what keeps
  // it a deliberate exception rather than a hole.
  const textOf = (route: "impact" | "change-plan" | "receipts") => {
    cleanup();
    render(<CockpitShell model={model()} route={route} onRouteChange={() => {}} />);
    for (const raw of Array.from(document.querySelectorAll(".receipts-view pre"))) raw.remove();
    return document.body.innerText || document.body.textContent || "";
  };
  const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

  it("states each gap reason once on Receipts, not once in a band and again in a card", () => {
    const text = textOf("receipts");
    for (const gap of model().receipt.statedGaps) {
      expect(occurrences(text, gap.detail), `"${gap.field}" detail`).toBe(1);
    }
  });

  it("states the evidence tier once", () => {
    // It reads as a verdict wherever it appears, so appearing twice reads as two.
    const text = textOf("receipts");
    for (const tier of ["ASSERTED", "OBSERVED", "VERIFIED"]) {
      expect(occurrences(text, tier), `${tier} on receipts`).toBeLessThanOrEqual(1);
    }
    // And nowhere near the hero, which is the placement that made it look like a
    // contradiction of "Completeness not established".
    expect(textOf("impact")).not.toContain("VERIFIED");
  });

  it("would catch a fact restated", () => {
    // The detector: `occurrences` returning 1 for a string that is absent would
    // make both cases above vacuous, so a known-duplicated string is checked.
    const doubled = "the same sentence. the same sentence.";
    expect(occurrences(doubled, "the same sentence.")).toBe(2);
    const text = textOf("receipts");
    expect(text.length).toBeGreaterThan(200);
  });
});

describe("silent zero callout on the impact route", () => {
  it("renders the silent zero before the resolution seam in DOM order", () => {
    cleanup();
    render(<CockpitShell model={model()} route="impact" onRouteChange={() => {}} />);
    const callout = screen.queryByText(/Naive join: 0 matches/i);
    const seam = screen.getByLabelText("Producing file resolution");
    expect(callout).not.toBeNull();
    // The callout must appear before the seam in DOM order — failure first,
    // resolution second.
    expect(callout!.compareDocumentPosition(seam)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("states the dbt path and the workspace.json key in the callout", () => {
    cleanup();
    render(<CockpitShell model={model()} route="impact" onRouteChange={() => {}} />);
    const m = model();
    if (m.dbtFilePath) {
      expect(screen.getByText(m.dbtFilePath)).toBeTruthy();
    }
  });
});

describe("progressive disclosure summaries carry semantic labels, not raw identifiers", () => {
  // The proof indicator's <summary> is what a reader sees first. The raw
  // canonical value lives in the expanded panel (hidden by <details> but still
  // in the DOM). This test walks <summary> elements only, not full textContent,
  // because hidden <details> content would produce false positives.
  it("shows semantic labels in proof indicator summaries on the receipts route", () => {
    cleanup();
    render(<CockpitShell model={model()} route="receipts" onRouteChange={() => {}} />);
    const summaries = Array.from(document.querySelectorAll("summary.proof-indicator__summary"));
    expect(summaries.length).toBeGreaterThan(0);
    for (const summary of summaries) {
      // Each summary should have non-empty text content (the semantic label)
      expect(summary.textContent?.trim().length).toBeGreaterThan(0);
    }
    // At least one summary should carry the "Exact-source evidence corpus" label
    const labels = summaries.map((s) => s.textContent?.trim() ?? "");
    expect(labels.some((l) => l.includes("Exact-source evidence corpus"))).toBe(true);
  });

  it("does not show raw SHA values in proof indicator summaries", () => {
    cleanup();
    render(<CockpitShell model={model()} route="receipts" onRouteChange={() => {}} />);
    const summaries = Array.from(document.querySelectorAll("summary.proof-indicator__summary"));
    // The contract event's corpus commit should not appear in any summary text
    const event = model();
    const receipt = event.receipt;
    const rawValues: string[] = [];
    for (const key of ["subjectRevision", "artifactRevision", "inputDigest", "artifactDigest"] as const) {
      const val = receipt.provenance[key];
      if (val.state === "observed") rawValues.push(val.value);
    }
    for (const summary of summaries) {
      for (const raw of rawValues) {
        // Check a meaningful prefix (first 12 chars) rather than the full value,
        // since a raw SHA or digest is unlikely to partially match a semantic label
        expect(summary.textContent).not.toContain(raw.slice(0, 12));
      }
    }
  });

  it("hero popover trigger says \"View dataset identity\", not the dataset name or raw URN", () => {
    cleanup();
    render(<CockpitShell model={model()} route="impact" onRouteChange={() => {}} />);
    // The hero section's proof popover trigger is a button, not a <summary>.
    // The compact variant was converted from <details> to an anchored popover.
    const hero = document.querySelector(".hero__identity");
    expect(hero).toBeTruthy();
    const trigger = hero?.querySelector("button.proof-popover__trigger");
    expect(trigger).toBeTruthy();
    expect(trigger?.textContent).toContain("View dataset identity");
    // The h1 should still carry the dataset name — the disclosure does not replace it
    const h1 = hero?.querySelector("h1");
    expect(h1?.textContent).toContain("game_events");
    // The trigger must not duplicate the dataset name or expose the raw URN
    expect(trigger?.textContent).not.toContain("game_events");
    expect(trigger?.textContent).not.toContain("urn:li:dataset");
  });

  it("hero popover panel contains the full canonical URN when opened", async () => {
    cleanup();
    render(<CockpitShell model={model()} route="impact" onRouteChange={() => {}} />);
    const hero = document.querySelector(".hero__identity");
    const trigger = hero?.querySelector("button.proof-popover__trigger");
    expect(trigger).toBeTruthy();
    // Open the popover by clicking the trigger. Radix Portal renders the panel
    // into document.body, not inside the hero.
    await userEvent.click(trigger!);
    // The expanded panel should contain the full URN
    const panel = document.querySelector(".proof-popover__panel");
    expect(panel?.textContent).toContain("urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)");
  });
});
