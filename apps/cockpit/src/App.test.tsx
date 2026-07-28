import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { App } from "./App";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

it("derives the shell state from URL query state and writes navigation back to the URL", async () => {
  window.history.replaceState(null, "", "/?view=receipts&state=success");
  const user = userEvent.setup();
  render(<App />);

  expect(screen.getByRole("button", { name: "Receipts" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByLabelText("Evidence state").textContent).toContain("complete-against-pinned-manifest");

  await user.click(screen.getByRole("button", { name: "Change plan" }));
  expect(new URLSearchParams(window.location.search).get("view")).toBe("change-plan");
  expect(new URLSearchParams(window.location.search).get("state")).toBe("success");
});
