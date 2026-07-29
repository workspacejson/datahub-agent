import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ChangeImpactEvent } from "../../src/integration/change-impact-event.js";
import { validateBundle, type RunIdentity } from "../../src/integration/plan-comparison.js";
import { runPairedPlan, type PlanInvoker } from "../../src/integration/paired-plan-runner.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const event = JSON.parse(readFileSync(join(root, "test/fixtures/golden/change-impact-event.nested.json"), "utf8")) as ChangeImpactEvent;
const run: RunIdentity = { taskId: "add-quality-check", promptDigest: "sha256:prompt", model: "qwen-test", settingsDigest: "sha256:settings" };

const controlledInvoker: PlanInvoker = async ({ mode, context }) => {
  if (mode === "datahub-only") {
    expect(context.code.repositoryRelativePath).toBeNull();
    return { steps: [
      { id: "inspect", action: "inspect DataHub lineage for the requested change" },
      { id: "refuse", action: "refuse to edit because the repository-relative source location is unknown" },
    ] };
  }
  return { steps: [
    { id: "checkout", action: "check out https://github.com/dcaribou/transfermarkt-datasets at 59fa295c51fc23466f3a71542f8bf3d1335daa83" },
    { id: "edit", action: "edit dbt/models/curated/game_events.sql and validate the requested dbt change" },
  ] };
};

describe("HAC-152 paired external-model runner", () => {
  it("invokes both controlled contexts with the same task identity and emits a validated non-empty comparison", async () => {
    const bundle = await runPairedPlan({ event, run, taskPrompt: "Add a quality check", invoke: controlledInvoker });
    expect(validateBundle(bundle)).toEqual([]);
    expect(bundle.comparison.deltas.map((delta) => delta.kind)).toEqual(["added", "removed", "constrained"]);
    expect(bundle.comparison.datahubOnlyPlan.steps.map((step) => step.action).join(" ")).toContain("unknown");
    expect(bundle.comparison.joinedPlan.steps.map((step) => step.action).join(" ")).toContain("dbt/models/curated/game_events.sql");
  });

  it("refuses a source path that is not established by an exact workspace artifact", async () => {
    const altered = JSON.parse(JSON.stringify(event)) as ChangeImpactEvent;
    altered.provenance.workspaceArtifact!.integrity = "revision-mismatch";
    await expect(runPairedPlan({ event: altered, run, taskPrompt: "Add a quality check", invoke: controlledInvoker })).rejects.toThrow(/exact corpus-matched/);
  });

  it("refuses a DataHub-only answer that guesses the joined source", async () => {
    const guessingInvoker: PlanInvoker = async ({ mode }) => mode === "datahub-only"
      ? { steps: [{ id: "guess", action: "edit dbt/models/curated/game_events.sql despite the unknown source" }] }
      : controlledInvoker({ mode, context: event, taskPrompt: "", run });
    await expect(runPairedPlan({ event, run, taskPrompt: "Add a quality check", invoke: guessingInvoker })).rejects.toThrow(/explicitly refuse/);
  });
});
