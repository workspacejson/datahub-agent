import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChangePlanView } from "./ChangePlanView";
import { provisionalStateAdapter } from "../data/cockpit-adapter";
import type { PlanComparisonView, PlanDelta } from "../model/cockpit-view-model";

afterEach(cleanup);

const withComparison = (planComparison: PlanComparisonView) => ({
  ...provisionalStateAdapter("partial").read(),
  planComparison,
});

const observed = (deltas: PlanDelta[]): PlanComparisonView => ({
  state: "observed",
  taskId: "add-quality-check",
  model: "qwen-plus",
  eventDigest: "digest-under-test",
  deltas,
});

it("renders removals and constraints as semantic plan deltas", () => {
  render(<ChangePlanView model={withComparison(observed([
    { kind: "removed", label: "Removed file", reason: "Evidence-backed removal.", source: "Joined", evidenceRefs: ["evidence.records[0]"] },
    { kind: "constrained", label: "Constrained step", reason: "Repository constraint.", source: "workspace.json", evidenceRefs: ["evidence.records[0]"] },
  ]))} />);
  expect(screen.getByText("removed")).toBeTruthy();
  expect(screen.getByText("constrained")).toBeTruthy();
});

it("shows the evidence behind every rendered delta", () => {
  // A delta on screen with no way back to its evidence is an assertion. The
  // carrier refuses to emit one, so the surface must not drop what it carries.
  render(<ChangePlanView model={withComparison(observed([
    { kind: "added", label: "Use exact source", reason: "Joined evidence resolved it.", source: "Joined", evidenceRefs: ["evidence.records[0]", "unavailable[\"code.repositoryRelativePath\"]"] },
  ]))} />);
  expect(screen.getByText(/evidence\.records\[0\]/)).toBeTruthy();
  expect(screen.getByText(/code\.repositoryRelativePath/)).toBeTruthy();
});

it("distinguishes a comparison that found nothing from no comparison at all", () => {
  // The distinction this view model was rebuilt to make. Both used to render as
  // an empty list.
  render(<ChangePlanView model={withComparison(observed([]))} />);
  expect(screen.getByText(/found no semantic difference/)).toBeTruthy();
  expect(screen.queryByText(/No plan comparison available/)).toBeNull();

  cleanup();

  render(<ChangePlanView model={withComparison({ state: "unavailable", reason: "nothing was run." })} />);
  expect(screen.getByText(/No plan comparison available/)).toBeTruthy();
  expect(screen.queryByText(/found no semantic difference/)).toBeNull();
});

it("names the run a comparison came from, so both plans can be checked as one question", () => {
  render(<ChangePlanView model={withComparison(observed([]))} />);
  expect(screen.getByText("add-quality-check")).toBeTruthy();
  expect(screen.getByText("qwen-plus")).toBeTruthy();
  expect(screen.getByText("digest-under-test")).toBeTruthy();
});
