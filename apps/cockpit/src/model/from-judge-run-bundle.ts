/**
 * Project a `JudgeRunBundle` — an event plus the comparison derived from it.
 *
 * Deliberately a separate module from `from-change-impact-event.ts`, and
 * deliberately **not reachable from `App.tsx`**.
 *
 * Verifying that a comparison is bound to its event means recomputing the
 * event's digest, `validateBundle` does exactly that, and `digestEvent` hashes
 * with `node:crypto`. Vite externalizes `node:crypto` for the browser rather
 * than failing the build, so importing this from the browser graph produced a
 * bundle that built cleanly, passed every node-environment unit test, and then
 * died on load — which is how it reached CI and was caught only by the
 * Playwright run.
 *
 * The alternatives were worse. Skipping the digest check in the browser would
 * drop the one invariant that makes a delta attributable. Making `digestEvent`
 * async to reach Web Crypto would ripple through `validateBundle` and every
 * caller of a ratified contract, to buy a capability the browser does not need:
 * the cockpit's runtime job is to *render* a validated model, not to validate an
 * artifact. Validation belongs where the bundle is produced or loaded, which is
 * Node.
 *
 * So the split is the architecture, not a workaround. The browser-safe half
 * lives in `from-change-impact-event.ts` and states an absent comparison; this
 * half turns a real bundle into an observed one and runs under Node — in tests
 * today, and in whatever build-time bind HAC-218 chooses. `architecture-
 * invariants.test.ts` fails the suite if anything reachable from `App.tsx`
 * imports a `node:` builtin, so this cannot regress by being imported back in.
 */
import { toComparisonState, type PlanComparisonArtifact } from "@comparison";

import type { CockpitRoute, SourceEvent } from "./cockpit-view-model";
import { NO_COMPARISON_SUPPLIED, readChangeImpactEvent } from "./from-change-impact-event";

/**
 * Project the comparison half of a bundle.
 *
 * Every delta is tagged `Joined`, and that is a claim about how deltas come to
 * exist rather than a default. A delta is the difference between a plan made
 * without repository evidence and one made with it: neither side alone produces
 * it, so neither `DataHub` nor `workspace.json` is the honest tag. Reading a
 * finer source out of `evidenceRefs` would invent precision the comparison never
 * asserted — the refs are carried through instead, so a reader follows them to
 * the evidence rather than trusting a label derived from them.
 */
export function projectComparison(comparison: PlanComparisonArtifact): SourceEvent["planComparison"] {
  return {
    state: "observed",
    // Both plans are checked to share one run identity by `validateBundle`, so
    // reading the joined side is not a choice of sides.
    taskId: comparison.joinedPlan.run.taskId,
    model: comparison.joinedPlan.run.model,
    eventDigest: comparison.eventDigest,
    deltas: comparison.deltas.map((delta) => ({
      kind: delta.kind,
      label: delta.label,
      reason: delta.reason,
      source: "Joined" as const,
      evidenceRefs: [...delta.evidenceRefs],
    })),
  };
}

/**
 * Read a bundle into a projected view.
 *
 * The two halves fail differently, because they promise different things. A
 * malformed event has no view at all, so it is the only hard failure here. A
 * comparison that is absent or does not validate still has an honest rendering:
 * `toComparisonState` turns it into `unavailable` carrying the problems, which
 * the cockpit can show. Crashing instead would lose the diagnosis, and quietly
 * rendering the surviving deltas of a failed validation would turn a partial
 * artifact into a confident one — the failure that function exists to refuse.
 *
 * The comparison's own invariants are not re-implemented here. `validateBundle`,
 * reached through `toComparisonState`, is what checks that the digest binds the
 * comparison to *this* event, that both plans share one task, model, prompt and
 * settings, and that every delta cites evidence the event actually contains. A
 * second copy of those rules in the view layer is a second place for them to
 * drift.
 */
export function readJudgeRunBundle(
  bundle: unknown,
  route: CockpitRoute,
): { ok: true; event: SourceEvent } | { ok: false; problems: string[] } {
  const candidateEvent = (bundle as { event?: unknown } | null | undefined)?.event;
  const parsed = readChangeImpactEvent(candidateEvent, route);
  if (!parsed.ok) {
    return { ok: false, problems: parsed.problems.map((problem) => `event: ${problem}`) };
  }

  const state = toComparisonState(bundle, NO_COMPARISON_SUPPLIED);
  return {
    ok: true,
    event: {
      ...parsed.event,
      planComparison: state.status === "observed"
        ? projectComparison(state.comparison)
        : { state: "unavailable", reason: state.reason },
    },
  };
}
