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
  await user.click(screen.getByRole("button", { name: "Change plan" }));
  expect(route).toBe("change-plan");
});

it("does not present a placeholder warning for non-placeholder models", () => {
  const placeholder = provisionalStateAdapter("partial").read();
  render(<CockpitShell model={{ ...placeholder, sourceMode: "live" }} route="receipts" onRouteChange={() => undefined} />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByText("Review changed plan")).toBeNull();
});
