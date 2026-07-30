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
  await user.click(screen.getByRole("button", { name: "Continue to change plan" }));
  expect(route).toBe("change-plan");
});

it("offers no View Source link in placeholder mode, and never tags unavailable as a source", () => {
  // Placeholder mode previously carried `https://example.invalid/...`, which is
  // a live link on a judge-facing screenshot. Absence states itself instead.
  const model = provisionalStateAdapter("partial").read();
  render(<CockpitShell model={model} route="impact" onRouteChange={() => undefined} />);
  expect(screen.queryByRole("link", { name: "View source at this revision" })).toBeNull();
  expect(screen.getByText(/View Source unavailable/).textContent).toContain("evidence binding is pending");
  expect(screen.queryByText("unavailable", { selector: ".source-tag" })).toBeNull();
});

it("labels a constructed link as constructed, and shows what it was built from", () => {
  // A constructed link is exactly as clickable as a declared one, so the label
  // is the only thing stopping a reader taking it for a catalog assertion.
  const model = provisionalStateAdapter("partial").read();
  const viewSource = {
    state: "constructed",
    url: "https://github.com/dcaribou/transfermarkt-datasets/blob/59fa295c/dbt/models/curated/game_events.sql",
    from: {
      repository: "https://github.com/dcaribou/transfermarkt-datasets",
      revision: "59fa295c",
      path: "dbt/models/curated/game_events.sql",
    },
  } as const;
  render(<CockpitShell model={{ ...model, viewSource }} route="impact" onRouteChange={() => undefined} />);
  expect(screen.getByRole("link", { name: "View source at this revision" }).getAttribute("href")).toBe(viewSource.url);
  expect(screen.getByText(/constructed, not catalog-supplied/)).toBeTruthy();
  expect(screen.getByText(/drops/).textContent).toContain("dbt/models/curated/game_events.sql");
});

it("does not claim construction when the catalog declared the link", () => {
  const model = provisionalStateAdapter("partial").read();
  const viewSource = { state: "declared", url: "https://example.com/declared.sql" } as const;
  render(<CockpitShell model={{ ...model, viewSource }} route="impact" onRouteChange={() => undefined} />);
  expect(screen.getByRole("link", { name: "View source at this revision" }).getAttribute("href")).toBe(viewSource.url);
  expect(screen.getByText(/declared by the catalog/)).toBeTruthy();
  expect(screen.queryByText(/constructed, not catalog-supplied/)).toBeNull();
});

it("announces evidence-state changes, which happen without a reload", () => {
  // The attribute shipped once with no assertion. Under this project's own
  // rule a claim carries the check that keeps it true, so this is that check:
  // the coverage panel is a polite live region, and it is the panel not the shell.
  const model = provisionalStateAdapter("partial").read();
  render(<CockpitShell model={model} route="impact" onRouteChange={() => undefined} />);
  const strip = screen.getByLabelText("Coverage of this review");
  expect(strip.getAttribute("aria-live")).toBe("polite");
  // Still carries the axes, so this fails if the panel stops reflecting them.
  expect(strip.textContent).toContain(model.resolutionDisposition);
});

it("does not present a placeholder warning for non-placeholder models", () => {
  const placeholder = provisionalStateAdapter("partial").read();
  render(<CockpitShell model={{ ...placeholder, sourceMode: "committed" }} route="receipts" onRouteChange={() => undefined} />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("button", { name: "Continue to change plan" })).toBeNull();
});
