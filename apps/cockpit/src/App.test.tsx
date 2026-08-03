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
  // The outcome bar states completeness in words with a subject rather than as
  // the bare contract token, which had no visible referent on the frame. It
  // moved here from the hero panel when the bar took over the fact: the bar
  // holds it on every route, and the hero renders the consequence only.
  expect(screen.getByLabelText("Standing of this review").textContent).toContain("Complete against pinned manifest");

  await user.click(screen.getByRole("button", { name: "Change plan" }));
  expect(window.location.pathname).toBe("/change-plan");
  expect(new URLSearchParams(window.location.search).get("state")).toBe("success");
});
