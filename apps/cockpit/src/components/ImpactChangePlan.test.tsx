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
  datahubOnlySteps: ["Refuse to edit an unknown source location."],
  joinedSteps: ["Edit dbt/models/curated/game_events.sql."],
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

/**
 * Parity is fail-closed.
 *
 * The visible sentence above the panels is what lets a reader treat the two
 * plans as a comparison rather than two lists, so it may only appear when every
 * dimension it names is observed. These assert both directions, because a claim
 * that cannot fail is not a claim.
 */
const withProvenance = (overrides: Record<string, unknown>) => {
  const base = provisionalStateAdapter("partial").read();
  return {
    ...base,
    planComparison: observed([]),
    receipt: { ...base.receipt, provenance: { ...base.receipt.provenance, ...overrides } },
  };
};

const attested = {
  dataHubReadParameters: { state: "observed", value: "gms http://localhost:8080", source: "DataHub" },
  subjectRevision: { state: "observed", value: "59fa295c", source: "workspace.json" },
} as const;

it("asserts a controlled comparison only when every named dimension is attested", () => {
  render(<ChangePlanView model={withProvenance({ ...attested }) as never} />);
  expect(screen.getByText(/Controlled comparison/)).toBeTruthy();
});

/*
  This pair used to assert that the causal sentence travelled with the parity
  controls. That coupling was the defect: parity establishes that one comparison
  was fair, which is not evidence about what the join caused. A fair comparison
  of a single run is still a single run.

  The measured claim now cites HAC-150's ten paired runs and renders
  unconditionally, so what these tests protect has changed. Parity still gates
  the fairness assertion, and the citation must not move with it in either
  direction.
*/
it("keeps the fairness control gated when a dimension is not attested", () => {
  const model = withProvenance({
    ...attested,
    subjectRevision: { state: "unavailable", reason: "not recorded for this run" },
  });
  render(<ChangePlanView model={model as never} />);

  expect(screen.getByText(/Comparison controls not established/)).toBeTruthy();
  expect(screen.getByText(/repository revision/)).toBeTruthy();
  // The sentence this replaced. Its absence is the change.
  expect(screen.queryByText(/What the join added/)).toBeNull();
});

it("renders the cited evaluation whether the controls are open or closed", () => {
  const cited = /the plan included the exact source revision in 10\/10 joined-context runs and 0\/10 DataHub-only runs/;

  const { unmount } = render(<ChangePlanView model={withProvenance({ ...attested }) as never} />);
  expect(screen.getByText(cited)).toBeTruthy();
  unmount();

  render(
    <ChangePlanView
      model={
        withProvenance({
          ...attested,
          subjectRevision: { state: "unavailable", reason: "not recorded for this run" },
        }) as never
      }
    />,
  );
  expect(screen.getByText(cited)).toBeTruthy();
});
