import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChangePlanView } from "./ChangePlanView";
import { provisionalStateAdapter } from "../data/cockpit-adapter";
afterEach(cleanup);
it("renders removals and constraints as semantic plan deltas", () => {
  const model = provisionalStateAdapter("partial").read();
  render(<ChangePlanView model={{ ...model, planDeltas: [{ kind: "removed", label: "Removed file", reason: "Evidence-backed removal.", source: "Joined" }, { kind: "constrained", label: "Constrained step", reason: "Repository constraint.", source: "workspace.json" }] }} />);
  expect(screen.getByText("removed")).toBeTruthy();
  expect(screen.getByText("constrained")).toBeTruthy();
});
