import { cleanup, render, screen } from "@testing-library/react";
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
const model = () => createAdapter(contractEvent(), "fixture").read();

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
