import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { CockpitShell } from "./components/CockpitShell";
import { createAdapter } from "./data/cockpit-adapter";
import { contractEvent } from "./test/contract-event";
import { comparison } from "./test/judge-run-bundle";
import { cockpitRouteSchema } from "./model/cockpit-view-model";
import { projectComparison } from "./model/project-comparison";

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

describe("the cited evaluation result is rendered verbatim and unconditionally", () => {
  /*
    These two sentences are citations of HAC-150, not descriptions of the model
    on screen, so they are pinned character for character. A reworded count is a
    different claim about a fixed experiment, and the experiment cannot be
    reworded to match.

    They are asserted on the rendered route rather than on the source string,
    because a sentence moved behind a condition would still exist in the file
    while being invisible to a judge. That is precisely the failure this pin
    exists to catch: the copy it replaced was gated on `parityControls`, which
    established fairness rather than cause.
  */
  const REVISION_CLAIM =
    "Across 10 controlled paired runs on the pinned corpus, the plan included the exact source revision in 10/10 joined-context runs and 0/10 DataHub-only runs.";
  const STABILITY_CLAIM =
    "DataHub-only produced five distinct normalized step sequences across 10 runs. Joined context produced one.";

  const changePlanText = () => {
    cleanup();
    render(<CockpitShell model={model()} route="change-plan" onRouteChange={() => {}} />);
    const block = document.querySelector('[aria-label="Repeated paired evaluation"]');
    return (block?.textContent ?? "").replace(/\s+/g, " ").trim();
  };

  it("states the revision-inclusion result with both denominators", () => {
    expect(changePlanText()).toContain(REVISION_CLAIM);
  });

  it("states the sequence-stability result as normalized sequences, not identical plans", () => {
    const text = changePlanText();
    expect(text).toContain(STABILITY_CLAIM);
    // "identical plans" would overclaim what the normalization compared.
    expect(text).not.toContain("identical plan");
  });

  it("renders even when this model carries no plan comparison at all", () => {
    /*
      The hardest case, and the one the contract-event fixture actually
      exercises: `planComparison` is `unavailable`, so the route takes its early
      return and never reaches the panels, the parity strip, or the delta list.

      The citation must still be there. It is the result of an experiment that
      already ran, not a statement about this event, so an event without a
      comparison is no reason to withhold it. Gating it on the model would be
      the same mistake as gating it on `parityControls`, one level down.
    */
    cleanup();
    render(<CockpitShell model={model()} route="change-plan" onRouteChange={() => {}} />);
    expect(document.body.textContent).toContain("No plan comparison available");
    const block = document.querySelector('[aria-label="Repeated paired evaluation"]');
    expect((block?.textContent ?? "").replace(/\s+/g, " ")).toContain(REVISION_CLAIM);
  });

  it("stays out of the parity control's scope", () => {
    // Parity establishes fairness for one run. The citation is ten runs. The
    // two must not share a truth condition, so the citation lives outside the
    // element the parity gate governs.
    cleanup();
    render(<CockpitShell model={model()} route="change-plan" onRouteChange={() => {}} />);
    const block = document.querySelector('[aria-label="Repeated paired evaluation"]');
    expect(block).not.toBeNull();
    expect(block?.closest(".parity-claim")).toBeNull();
    expect(block?.closest(".parity-detail")).toBeNull();
  });

  it("links to the receipt the numbers came from", () => {
    cleanup();
    render(<CockpitShell model={model()} route="change-plan" onRouteChange={() => {}} />);
    const link = document.querySelector('a.evaluation-claim__source');
    expect(link?.getAttribute("href")).toBe("https://github.com/workspacejson/datahub-agent/tree/main/evaluation/hac-150");
  });

  it("no longer claims what the join added", () => {
    // The replaced sentence. Its absence is the point of the change.
    cleanup();
    render(<CockpitShell model={model()} route="change-plan" onRouteChange={() => {}} />);
    expect(document.body.textContent).not.toContain("What the join added");
  });
});

describe("no route denies the evaluation another route cites", () => {
  /*
    Receipts carried `evaluation.pairedSpread`, an unconditional
    `missing("The paired DataHub-only vs joined evaluation has not been run.")`.
    After HAC-150 ran, the build stated the ten-run result on Change plan and
    denied it on Receipts, under a heading that reads "Limitations lead".

    The pin above holds the citation in place. This one holds the other side: no
    route may state that the paired evaluation did not happen. Together they
    close the contradiction from both ends, because fixing only the denial leaves
    a build that can drift back into it the next time someone needs a plausible
    absence to render.

    Scanned on the rendered routes, not on source. A literal reintroduced through
    a component, a fixture or a contract string reads identically to a judge, and
    the original defect was exactly a literal no test named.
  */
  const DENIAL = /(paired|comparative)[^.]{0,60}evaluation[^.]{0,60}(has not been|was not|were not|never)\s+(run|performed|conducted)/i;

  /** Every route's rendered text, minus the raw receipt, which is the event verbatim. */
  const routeText = (route: string) => {
    cleanup();
    render(<CockpitShell model={model()} route={route as never} onRouteChange={() => {}} />);
    for (const raw of Array.from(document.querySelectorAll(".receipts-view pre"))) raw.remove();
    return (document.body.textContent ?? "").replace(/\s+/g, " ");
  };

  it("states no denial of the paired evaluation on any route", () => {
    const offenders = ROUTES
      .map((route) => [route, routeText(route)] as const)
      .filter(([, text]) => DENIAL.test(text))
      .map(([route, text]) => `${route}: ${DENIAL.exec(text)?.[0] ?? ""}`);
    expect(offenders).toEqual([]);
  });

  it("names no paired-evaluation spread it cannot source", () => {
    // The field's own label, gone with it. `ChangeImpactEvent` 1.3 carries no
    // evaluation reference, so a receipt row for one can only be a literal.
    expect(routeText("receipts")).not.toContain("Paired evaluation spread");
  });

  it("would catch the denial reintroduced through any evidence value", () => {
    /*
      The detector, against a constructed violation, in the idiom of the em dash
      guard above. Both scans pass trivially on a tree that renders no text, and
      the removed field is no longer in the schema to reinject — so the check is
      that the scan trips on the sentence wherever it reaches the page. Without
      this, deleting the row would silently disarm the guard that replaced it.
    */
    cleanup();
    const base = model();
    render(
      <CockpitShell
        model={{
          ...base,
          receipt: {
            ...base.receipt,
            evaluation: {
              ...base.receipt.evaluation,
              locBaseline: { state: "unavailable", reason: "The paired DataHub-only vs joined evaluation has not been run." },
            },
          },
        }}
        route="receipts"
        onRouteChange={() => {}}
      />,
    );
    for (const raw of Array.from(document.querySelectorAll(".receipts-view pre"))) raw.remove();
    expect(DENIAL.test((document.body.textContent ?? "").replace(/\s+/g, " "))).toBe(true);
  });
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

/**
 * The silent-zero result line, matched on the paragraph's full text.
 *
 * `queryByText` matches within a single text node. "Naive join" is a
 * `TermDefinition` trigger, so the sentence now spans a <button> and the text
 * node after it, and no single node carries the whole string. Asserting on the
 * paragraph's `textContent` keeps the *same sentence* under test — and in fact
 * a stricter one than before, since the previous matcher stopped at
 * "0 matches" and this requires the full line including the exit code.
 */
function silentZeroResult(): HTMLElement | null {
  const node = document.querySelector<HTMLElement>("p.silent-zero__result");
  if (node === null) return null;
  const expected = /Naive join: 0 matches\. No error\. No warning\. Exit code 0\./i;
  return expected.test(node.textContent ?? "") ? node : null;
}

describe("silent zero callout rendered on all routes via CockpitShell hero", () => {
  it("renders the silent zero before the resolution seam in DOM order on impact", () => {
    cleanup();
    render(<CockpitShell model={model()} route="impact" onRouteChange={() => {}} />);
    const callout = silentZeroResult();
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
      const escaped = m.dbtFilePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(screen.getAllByText(new RegExp(escaped)).length).toBeGreaterThan(0);
    }
  });

  /*
    This used to assert the callout itself on all three routes, because the hero
    rendered everywhere and the callout was the only thing carrying the argument
    off Impact.

    The full hero is now Impact's, so that assertion would only be satisfiable by
    putting the argument back where it pushed the primary action toward the fold.
    What the original guard was protecting is that a reader who navigates away
    from Impact does not lose the standing of the review -- so that is what is
    asserted here, against the surface that now carries it. The callout keeps its
    own guards above: it still leads Impact, still precedes the seam.
  */
  for (const route of ROUTES) {
    it(`states the source resolution on the ${route} route`, () => {
      cleanup();
      const m = model();
      render(<CockpitShell model={m} route={route} onRouteChange={() => {}} />);
      const bar = screen.getByLabelText("Standing of this review");
      expect(bar.textContent?.toLowerCase()).toContain(m.resolutionDisposition.toLowerCase());
    });

    it(`names the dataset under review on the ${route} route`, () => {
      cleanup();
      const m = model();
      render(<CockpitShell model={m} route={route} onRouteChange={() => {}} />);
      // The bar carries the standing but never the subject. Without this the
      // identity block could be gated with the rest of the hero and two routes
      // would stop saying what they are about.
      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(m.title);
    });
  }
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

describe("no plan-comparison surface calls a recorded value a decision", () => {
  /*
    Nothing in the contract records a plan's disposition. `PlanDeltaKind` is
    `added | removed | reordered | constrained | uncertainty-changed`, and there
    is no approve/reject state anywhere in `plan-comparison.ts`. So the panels
    promote the first entry of each list and label the comparison by what it
    observed -- "Without joined evidence", "With joined evidence" -- and never by
    what anyone concluded. Calling either value a decision would assert a
    disposition the artifact does not carry, and would put a second source of
    truth beside the step lists that could contradict them.

    This is a ruling, and it is here because the last place that held it was a
    code comment on `firstAction` that the reduction pass deleted along with the
    code it annotated. A comment cannot survive the removal of its subject; an
    assertion on the rendered output can. A design canvas has proposed the
    decision word more than once, so the next proposal should fail a test rather
    than reach a reviewer.

    Scoped to label-shaped elements -- headings, eyebrows, field labels, and the
    delta `kind`, which is the contract enum rendered verbatim. Values are
    deliberately excluded: a step, a delta label and a reason are the run's own
    recorded words, and banning a vocabulary inside them would censor the
    artifact instead of governing the interface. `.delta__kind` is in scope
    precisely because a `decision` member added to the contract enum should fail
    here too.
  */
  const DECISION_VOCABULARY = /\b(decisions?|dispositions?|verdicts?|approv(e|ed|al)|reject(ed|ion)?)\b/i;

  /**
   * Label-shaped text inside the plan-comparison surfaces, with where it came
   * from. `.plan-delta` renders on Impact as well, so both routes are read.
   */
  const LABEL_SELECTOR = [
    ".plan-delta__heading",
    ".plan-delta__caption",
    ".plan-delta__label",
    ".eyebrow",
    "h2",
    "h3",
    "summary",
    ".parity-label",
    ".delta__kind",
  ].join(", ");

  /**
   * The shared fixture carries no comparison, so the panels this rule governs
   * never render from it. Projecting a real bundle through the carrier's own
   * `projectComparison` puts the plan panels, the parity strip and the delta
   * list on screen -- which is where the decision word would actually appear.
   */
  const comparedModel = () => {
    const event = contractEvent();
    return { ...model(), planComparison: projectComparison(comparison(event)) };
  };

  function comparisonLabels(): Array<[string, string]> {
    const found: Array<[string, string]> = [];
    for (const route of ROUTES) {
      cleanup();
      render(<CockpitShell model={comparedModel()} route={route} onRouteChange={() => {}} />);
      // Two scopes, because the delta band is shared and the rest of the route
      // is not. `.decision-bar` is deliberately outside both: "Decide: apply
      // this plan, or stop here" asks the reader for an action, which is a
      // different thing from labelling a recorded value.
      const scopes = document.querySelectorAll('section[aria-label="Plan comparison"], .plan-delta');
      for (const scope of Array.from(scopes)) {
        for (const el of Array.from(scope.querySelectorAll(LABEL_SELECTOR))) {
          const text = el.textContent ?? "";
          if (text.trim()) found.push([route, text.trim()]);
        }
      }
    }
    cleanup();
    return found;
  }

  it("finds the comparison labels, so a markup change cannot empty this suite", () => {
    const labels = comparisonLabels().map(([, text]) => text);
    // Without this the assertion below passes over an empty list the moment a
    // class is renamed -- which is exactly how the previous home of this ruling
    // was lost.
    expect(labels.length).toBeGreaterThan(5);
    for (const anchor of ["Without joined evidence", "With joined evidence", "Changed plan"]) {
      expect(labels, `"${anchor}" is missing, so the scope no longer covers the plan comparison`).toContain(anchor);
    }
  });

  it("labels every comparison value by what was recorded, not by a disposition", () => {
    const offenders = comparisonLabels()
      .filter(([, text]) => DECISION_VOCABULARY.test(text))
      .map(([route, text]) => `${route}: "${text.slice(0, 80)}"`);
    expect(
      offenders,
      "A plan-comparison label used decision vocabulary. Nothing in the contract records a plan's " +
      "disposition, so naming one asserts a claim the artifact does not carry. Use the recorded " +
      "vocabulary instead -- first planned action, target, revision, reason -- or add a typed " +
      "planDisposition to the contract first. See docs/cockpit-architecture.md.",
    ).toEqual([]);
  });
});
