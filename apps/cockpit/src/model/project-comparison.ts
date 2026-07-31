/**
 * The comparison projection, and the one sentence that states its absence.
 *
 * Split out of `from-judge-run-bundle.ts` so that three callers can share it
 * without any of them dragging in the others' dependencies. Every import here is
 * `import type`, which erases at build time, so this module has **no runtime
 * imports at all**. That is the property the split exists to buy:
 *
 *   browser   `from-change-impact-event.ts` needs `NO_COMPARISON_SUPPLIED` and
 *             reaches `@contract`, which the browser graph already carries.
 *   node      `from-judge-run-bundle.ts` needs `projectComparison` and reaches
 *             `@comparison`, which hashes with `node:crypto`.
 *   build     `vite.config.ts` needs both and can reach neither, because a Vite
 *             config resolves no app aliases when it is itself compiled.
 *
 * Before this module existed the build had exactly two options, and both were
 * worse: import the Node half into the config and lose alias resolution, or
 * restate the projection in the config and let two copies of "how a delta is
 * attributed" drift apart.
 */
import type { PlanComparisonArtifact } from "@comparison";
import type { SourceEvent } from "./cockpit-view-model";

/**
 * Why a view built from an event alone has no comparison.
 *
 * One constant, used both by `projectEvent` and as `toComparisonState`'s
 * null-bundle reason, so the two paths cannot come to describe the same absence
 * in two different ways.
 */
export const NO_COMPARISON_SUPPLIED =
  "this view was built from a change-impact event alone. The event contract carries evidence, not plans: " +
  "a DataHub-only/joined comparison is a separate artifact bound to the event by digest, and none was supplied";

/**
 * Project the comparison half of a bundle.
 *
 * Every delta is tagged `Joined`, and that is a claim about how deltas come to
 * exist rather than a default. A delta is the difference between a plan made
 * without repository evidence and one made with it: neither side alone produces
 * it, so neither `DataHub` nor `workspace.json` is the honest tag. Reading a
 * finer source out of `evidenceRefs` would invent precision the comparison never
 * asserted, so the refs are carried through instead and a reader follows them to
 * the evidence rather than trusting a label derived from them.
 *
 * Both plans are carried as well as the deltas. The frame's whole argument is
 * that a reader sees which system contributed what before reading a word of
 * plan, and a delta list alone shows the difference while hiding the two things
 * differing.
 */
export function projectComparison(comparison: PlanComparisonArtifact): SourceEvent["planComparison"] {
  return {
    state: "observed",
    // Both plans are checked to share one run identity by `validateBundle`, so
    // reading the joined side is not a choice of sides.
    taskId: comparison.joinedPlan.run.taskId,
    model: comparison.joinedPlan.run.model,
    eventDigest: comparison.eventDigest,
    eventDigestIdentifier: {
      type: "event-digest",
      semanticLabel: "View binding proof",
      copyLabel: "Copy digest",
    },
    datahubOnlySteps: comparison.datahubOnlyPlan.steps.map((step) => step.action),
    joinedSteps: comparison.joinedPlan.steps.map((step) => step.action),
    deltas: comparison.deltas.map((delta) => ({
      kind: delta.kind,
      label: delta.label,
      reason: delta.reason,
      source: "Joined" as const,
      evidenceRefs: [...delta.evidenceRefs],
    })),
  };
}
