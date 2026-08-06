import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { App } from "./App";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

it("derives the shell state from URL query state and writes navigation back to the URL", async () => {
  window.history.replaceState(null, "", "/receipts?state=success");
  const user = userEvent.setup();
  render(<App />);

  expect(screen.getByRole("button", { name: "Receipts" }).getAttribute("aria-current")).toBe("step");

  /*
    The route the URL selected still states where the review stands.

    This used to read the six-cell status strip, which carried source, lineage,
    coverage, plan, writeback and limitations on every route. The strip is gone:
    each of those facts now appears once, in the band that owns it, so the check
    is that both halves of the standing survived the redistribution rather than
    that one element still holds all six.

    Resolution is on the subject band, which every route renders. Completeness is
    on the scope strip on Impact and Change plan, and here in the provenance line,
    which is the route that states it in full — a scope strip on Receipts would
    put the same claim on one route twice, which `house-copy.test.tsx` forbids.
  */
  expect(screen.getByLabelText("Standing of this review").textContent).toContain("exact");
  expect(document.body.textContent).toContain("Complete against pinned manifest");

  await user.click(screen.getByRole("button", { name: "Change plan" }));
  expect(window.location.pathname).toBe("/change-plan");
  expect(new URLSearchParams(window.location.search).get("state")).toBe("success");
});
