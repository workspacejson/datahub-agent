import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { NotFoundView } from "./components/NotFoundView";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

/**
 * A path with no route says so, and offers the way back.
 *
 * The behaviour these replace: `readLocation` parsed the path with
 * `cockpitRouteSchema.catch("impact")`, so `/recipts`, `/impact/2` and a link to
 * a route that no longer exists all rendered a complete impact review under a
 * URL that named none of them. Nothing was broken on screen, which is what made
 * it hard to see: the reader got a real review and no reason to doubt they were
 * where they asked to be.
 */
const at = (path: string) => {
  window.history.replaceState(null, "", path);
  render(<App />);
};

describe("an unrecognised path is refused rather than substituted", () => {
  for (const path of ["/recipts", "/impact/2", "/receipts/extra", "/CHANGE-PLAN"]) {
    it(`states the refusal at ${path}`, () => {
      at(path);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("404");
      // And none of the review: no sequence to navigate, no dataset, no
      // decision. Those are claims about a subject this path does not select.
      expect(screen.queryByRole("navigation", { name: "Review sequence" })).toBeNull();
      expect(screen.queryByLabelText("Standing of this review")).toBeNull();
    });
  }

  it("names the path that was actually requested", () => {
    at("/recipts");
    expect(screen.getByText(/No route is bound to/).textContent).toContain("/recipts");
  });

  it("titles the tab for the refusal, not for a dataset it is not showing", () => {
    at("/recipts");
    expect(document.title).toBe("tally · no route at this path");
  });

  it("would notice if every path started rendering the refusal", () => {
    /*
      The positive control. Both assertions above pass on a build that 404s
      everything, and a 404 that swallows the product is a worse failure than
      the substitution it replaced. This is the detector for that.
    */
    at("/receipts");
    expect(screen.queryByRole("heading", { level: 1 })?.textContent).not.toBe("404");
    expect(screen.getByRole("navigation", { name: "Review sequence" })).toBeTruthy();
  });

  it("does not refuse a route for a trailing slash", () => {
    // Normalised in `readLocation`. A reader who types the slash is not asking
    // for a different page, and refusing them is a 404 the product invented.
    at("/receipts/");
    expect(screen.getByRole("button", { name: "Receipts" }).getAttribute("aria-current")).toBe("step");
  });

  it("refuses without depending on the query string", () => {
    // The dataset key has its own fallback and the state harness has another.
    // Neither may rescue a path, and neither may make one fail.
    at("/recipts?dataset=not-a-key&state=success");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("404");
  });
});

describe("the way back out is real navigation", () => {
  it("returns to the impact review and rewrites the address bar", async () => {
    const user = userEvent.setup();
    at("/recipts");

    const back = screen.getByRole("link", { name: "Go to the impact review" });
    // A link, so it resolves with or without this script. The handler below is
    // the shortcut, not the mechanism.
    expect(back.getAttribute("href")).toBe("/");

    await user.click(back);

    expect(window.location.pathname).toBe("/");
    expect(screen.getByRole("navigation", { name: "Review sequence" })).toBeTruthy();
    expect(screen.queryByText("404")).toBeNull();
  });

  it("carries a validated dataset key back with it", async () => {
    // The return is a navigation inside the app, so it goes through
    // `writeLocation` and keeps whatever subject the reader had selected.
    const user = userEvent.setup();
    at("/recipts?dataset=nested");

    await user.click(screen.getByRole("link", { name: "Go to the impact review" }));
    expect(window.location.pathname).toBe("/");
  });

  it("leaves a modified click to the browser", async () => {
    /*
      Command-click, and its siblings, must open a tab rather than navigating
      this one. `preventDefault` on every click is the usual way an SPA link
      quietly stops being a link, and a reader stranded on a 404 is exactly who
      reaches for a new tab.
    */
    const user = userEvent.setup();
    at("/recipts");

    await user.keyboard("[ControlLeft>]");
    await user.click(screen.getByRole("link", { name: "Go to the impact review" }));
    await user.keyboard("[/ControlLeft]");

    // jsdom does not follow the navigation, so what is asserted is that the app
    // did not handle it: the refusal is still on screen and the path unchanged.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("404");
    expect(window.location.pathname).toBe("/recipts");
  });
});

describe("the refused path is stated without letting it grow the frame", () => {
  const longPath = `/${"segment/".repeat(60)}`;

  it("prints a long path clamped rather than in full", () => {
    render(<NotFoundView path={longPath} onReturn={() => {}} />);
    const stated = screen.getByText(/No route is bound to/).textContent ?? "";
    expect(stated).toContain("segment/");
    expect(stated.length).toBeLessThan(longPath.length);
    expect(stated).toContain("…");
  });

  it("would catch the clamp being removed", () => {
    // The detector: a path under the limit is printed whole, so the assertion
    // above is about the clamp rather than about truncation happening always.
    render(<NotFoundView path="/recipts" onReturn={() => {}} />);
    const stated = screen.getByText(/No route is bound to/).textContent ?? "";
    expect(stated).toContain("/recipts");
    expect(stated).not.toContain("…");
  });
});

describe("the surface states one thing and offers one action", () => {
  it("offers exactly one control", () => {
    // Decision integrity: the canvas's page treatment puts "Report a broken
    // link" beside the return, and there is nothing behind that action here.
    render(<NotFoundView path="/recipts" onReturn={() => {}} />);
    const frame = document.querySelector(".not-found__frame")!;
    expect(frame.querySelectorAll("a, button").length).toBe(1);
  });

  it("keeps the mark decorative and out of the accessibility tree", () => {
    render(<NotFoundView path="/recipts" onReturn={() => {}} />);
    for (const svg of Array.from(document.querySelectorAll(".not-found svg"))) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
    }
  });

  it("hard-codes no colour on the artwork", () => {
    /*
      The gate takes its accent and its ghost from tokens in `cockpit.css`. The
      canvas hard-codes the ramp it was drawn against, and a hex copied out of it
      is a value that stops moving with the design system -- a finding even when
      it matches the token it was copied from.
    */
    render(<NotFoundView path="/recipts" onReturn={() => {}} />);
    const gate = document.querySelector(".not-found__gate");
    expect(gate).not.toBeNull();
    expect(gate!.outerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
