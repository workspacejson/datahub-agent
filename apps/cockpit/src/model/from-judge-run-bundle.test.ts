/**
 * The seam that binds an observed plan comparison into the cockpit's view model.
 *
 * Every bundle here is built from `contractEvent()` and digested with the
 * carrier's own `digestEvent`, so these tests exercise the real binding rules
 * rather than a hand-shaped object that resembles a bundle. A test that builds
 * its own digest would pass while the thing it claims to check was broken.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { digestEvent } from "@comparison";

import { contractEvent } from "../test/contract-event";
import { RUN, judgeRunBundle } from "../test/judge-run-bundle";
import { NO_COMPARISON_SUPPLIED, readChangeImpactEvent, readJudgeRunBundle } from "./from-change-impact-event";
import { cockpitViewModelSchema } from "./cockpit-view-model";

describe("projecting a JudgeRunBundle", () => {
  it("renders an observed comparison carrying its deltas and run identity", () => {
    const result = readJudgeRunBundle(judgeRunBundle(), "change-plan");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.problems.join("; "));

    const view = result.event.planComparison;
    expect(view.state).toBe("observed");
    if (view.state !== "observed") throw new Error("unreachable");
    expect(view.taskId).toBe("add-quality-check");
    expect(view.model).toBe("qwen-plus");
    expect(view.eventDigest).toBe(digestEvent(contractEvent()));
    expect(view.deltas).toHaveLength(1);
  });

  it("carries every delta's evidence references through to the view", () => {
    // The carrier refuses to emit a delta citing nothing. A view that dropped the
    // refs would render an assertion the artifact declined to make.
    const result = readJudgeRunBundle(judgeRunBundle(), "change-plan");
    if (!result.ok) throw new Error(result.problems.join("; "));
    const view = result.event.planComparison;
    if (view.state !== "observed") throw new Error("unreachable");
    expect(view.deltas[0]!.evidenceRefs).toEqual(["evidence.records[0]"]);
  });

  it("tags deltas Joined, because neither context alone produces one", () => {
    const result = readJudgeRunBundle(judgeRunBundle(), "change-plan");
    if (!result.ok) throw new Error(result.problems.join("; "));
    const view = result.event.planComparison;
    if (view.state !== "observed") throw new Error("unreachable");
    expect(view.deltas.every((delta) => delta.source === "Joined")).toBe(true);
  });

  it("keeps an observed comparison with no deltas distinct from an absent one", () => {
    // The whole reason this stopped being an array. Both used to be `[]`, so a
    // judge could not tell a measurement from a missing input.
    const empty = readJudgeRunBundle(judgeRunBundle(contractEvent(), { deltas: [] }), "change-plan");
    if (!empty.ok) throw new Error(empty.problems.join("; "));
    expect(empty.event.planComparison).toEqual({
      state: "observed",
      taskId: RUN.taskId,
      model: RUN.model,
      eventDigest: digestEvent(contractEvent()),
      deltas: [],
    });

    // The same subject read without a comparison: an absence, stating itself.
    const none = readChangeImpactEvent(contractEvent(), "change-plan");
    if (!none.ok) throw new Error(none.problems.join("; "));
    expect(none.event.planComparison).toEqual({ state: "unavailable", reason: NO_COMPARISON_SUPPLIED });
  });

  it("states a comparison bound to a different event as unavailable, not observed", () => {
    // The defect that makes a delta unattributable: two plans compared against
    // evidence nobody can tie to this event.
    const result = readJudgeRunBundle(judgeRunBundle(contractEvent(), { eventDigest: "sha256:not-this-event" }), "change-plan");
    if (!result.ok) throw new Error(result.problems.join("; "));
    const view = result.event.planComparison;
    expect(view.state).toBe("unavailable");
    if (view.state !== "unavailable") throw new Error("unreachable");
    expect(view.reason).toMatch(/did not validate/);
    expect(view.reason).toMatch(/eventDigest/);
  });

  it("refuses a delta citing evidence the event does not contain", () => {
    const result = readJudgeRunBundle(
      judgeRunBundle(contractEvent(), { deltas: [{ kind: "added", label: "invented support", reason: "cites a record that is not there", evidenceRefs: ["evidence.records[99]"] }] }),
      "change-plan",
    );
    if (!result.ok) throw new Error(result.problems.join("; "));
    expect(result.event.planComparison.state).toBe("unavailable");
  });

  it("refuses a comparison whose two plans ran under different settings", () => {
    const confounded = readJudgeRunBundle(
      judgeRunBundle(contractEvent(), { joinedPlan: { mode: "joined", run: { ...RUN, settingsDigest: "sha256:3333" }, steps: [{ id: "s2", action: "edit" }] } }),
      "change-plan",
    );
    if (!confounded.ok) throw new Error(confounded.problems.join("; "));
    const view = confounded.event.planComparison;
    expect(view.state).toBe("unavailable");
    if (view.state !== "unavailable") throw new Error("unreachable");
    expect(view.reason).toMatch(/confounded/);
  });

  it("fails hard on a malformed event, which has no view at all", () => {
    const result = readJudgeRunBundle({ bundleVersion: "1.0", event: { eventVersion: "1.3" }, comparison: {} }, "change-plan");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("a malformed event must not project");
    expect(result.problems.every((problem) => problem.startsWith("event: "))).toBe(true);
  });

  it("produces a model the view-model schema accepts", () => {
    const result = readJudgeRunBundle(judgeRunBundle(), "change-plan");
    if (!result.ok) throw new Error(result.problems.join("; "));
    expect(cockpitViewModelSchema.safeParse({ ...result.event, sourceMode: "live" }).success).toBe(true);
  });

  it("renders the committed live bundle, deltas and all", () => {
    // The claim this binding exists to support, checked against the artifact a
    // judge is handed rather than a fixture built to suit it. If the real
    // `qwen-plus` run cannot reach the screen, nothing above matters.
    const live = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../../evaluation/hac-152/live-qwen-judge-run-bundle.json"), "utf8"),
    );
    const result = readJudgeRunBundle(live, "change-plan");
    if (!result.ok) throw new Error(result.problems.join("; "));

    const view = result.event.planComparison;
    expect(view.state).toBe("observed");
    if (view.state !== "observed") throw new Error("unreachable");
    expect(view.model).toBe("qwen-plus");
    expect(view.deltas.map((delta) => delta.kind)).toEqual(["added", "removed", "constrained"]);
    expect(view.deltas.every((delta) => delta.evidenceRefs.length > 0)).toBe(true);
    expect(cockpitViewModelSchema.safeParse({ ...result.event, sourceMode: "live" }).success).toBe(true);
  });
});
