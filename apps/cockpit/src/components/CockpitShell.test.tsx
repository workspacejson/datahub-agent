import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { CockpitShell } from "./CockpitShell";
import type { CockpitViewModel } from "../model/cockpit-view-model";

const placeholder: CockpitViewModel = {
  sourceMode: "placeholder", route: "impact", source: "Joined", read: "not-queried",
  completeness: "not-established", resolutionDisposition: "partial", mutationAcceptance: "not-attempted",
  intendedStateObservation: "not-attempted", terminalWritebackDisposition: "not-applicable",
  title: "<asset>", summary: "<summary>", unresolvedItems: ["<residual>"],
};

afterEach(cleanup);

it("automatically warns for every placeholder frame and switches routes", async () => {
  const user = userEvent.setup();
  let route = placeholder.route;
  render(<CockpitShell model={placeholder} route={route} onRouteChange={(next) => { route = next; }} />);
  expect(screen.getByRole("status").textContent).toContain("DESIGN PLACEHOLDER · NOT OBSERVED DATA");
  await user.click(screen.getByRole("button", { name: "Change plan" }));
  expect(route).toBe("change-plan");
});

it("does not present a placeholder warning for non-placeholder models", () => {
  render(<CockpitShell model={{ ...placeholder, sourceMode: "live" }} route="receipts" onRouteChange={() => undefined} />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByText("Review changed plan")).toBeNull();
});
