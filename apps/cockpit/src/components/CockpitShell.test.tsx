import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { CockpitShell } from "./CockpitShell";
import { provisionalStateAdapter } from "../data/cockpit-adapter";

afterEach(cleanup);

it("automatically warns for every placeholder frame and switches routes", async () => {
  const user = userEvent.setup();
  const placeholder = provisionalStateAdapter("partial").read();
  let route = placeholder.route;
  render(<CockpitShell model={placeholder} route={route} onRouteChange={(next) => { route = next; }} />);
  expect(screen.getByRole("status").textContent).toContain("DESIGN PLACEHOLDER · NOT OBSERVED DATA");
  await user.click(screen.getByRole("button", { name: "Review changed plan" }));
  expect(route).toBe("change-plan");
});

it("offers an immutable View Source action and never tags unavailable as a source", () => {
  const model = provisionalStateAdapter("partial").read();
  render(<CockpitShell model={model} route="impact" onRouteChange={() => undefined} />);
  expect(screen.getByRole("link", { name: "View Source" }).getAttribute("href")).toBe(model.immutableViewSourceUrl);
  expect(screen.queryByText("unavailable", { selector: ".source-tag" })).toBeNull();
});

it("states the omission instead of offering a link when no commit-pinned URL exists", () => {
  const model = provisionalStateAdapter("partial").read();
  render(<CockpitShell model={{ ...model, immutableViewSourceUrl: null }} route="impact" onRouteChange={() => undefined} />);
  expect(screen.queryByRole("link", { name: "View Source" })).toBeNull();
  expect(screen.getByText(/View Source unavailable/).textContent).toContain("no link is offered rather than one that could drift");
  expect(screen.getByText("unavailable", { selector: "code" })).toBeTruthy();
});

it("announces evidence-state changes, which happen without a reload", () => {
  // The attribute shipped once with no assertion. Under this project's own
  // rule a claim carries the check that keeps it true, so this is that check:
  // the strip is a polite live region, and it is the strip and not the shell.
  const model = provisionalStateAdapter("partial").read();
  render(<CockpitShell model={model} route="impact" onRouteChange={() => undefined} />);
  const strip = screen.getByLabelText("Evidence state");
  expect(strip.getAttribute("aria-live")).toBe("polite");
  expect(strip.textContent).toContain(model.read);
});

it("does not present a placeholder warning for non-placeholder models", () => {
  const placeholder = provisionalStateAdapter("partial").read();
  render(<CockpitShell model={{ ...placeholder, sourceMode: "live" }} route="receipts" onRouteChange={() => undefined} />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("button", { name: "Review changed plan" })).toBeNull();
});
