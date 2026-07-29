/**
 * The adapter for a `JudgeRunBundle`, kept out of the browser graph.
 *
 * Split from `cockpit-adapter.ts` for the reason set out in
 * `../model/from-judge-run-bundle.ts`: validating a bundle means recomputing the
 * event digest, which hashes with `node:crypto`. `cockpit-adapter.ts` is
 * reachable from `App.tsx`, so anything it imports ships to the browser, and a
 * `node:` builtin there is externalized rather than rejected — a page that
 * builds and then fails to load.
 *
 * Nothing here may be imported by `cockpit-adapter.ts` or `select-adapter.ts`.
 * `architecture-invariants.test.ts` enforces that by walking the import graph
 * from `App.tsx`, so the boundary is checked rather than remembered.
 */
import { readJudgeRunBundle } from "../model/from-judge-run-bundle";
import { normalize, type CockpitSourceAdapter } from "./cockpit-adapter";
import type { SourceMode } from "../model/cockpit-view-model";

/**
 * Bind a validated bundle to a renderable model.
 *
 * Separate from `createAdapter` rather than a widened `unknown` branch, because
 * the two inputs make different promises. Passing a bundle to `createAdapter`
 * would render "no comparison supplied" for a bundle that supplied one, so the
 * caller states which it holds and gets the matching guarantee.
 *
 * Throws only when the bundled *event* is malformed, matching `createAdapter`. A
 * comparison that does not validate is not a crash: it reaches the view as
 * `unavailable` carrying the validation problems, because that is a state a
 * judge can read and act on.
 */
export function createComparisonAdapter(
  bundle: unknown,
  sourceMode: Exclude<SourceMode, "placeholder">,
): CockpitSourceAdapter {
  const result = readJudgeRunBundle(bundle, "change-plan");
  if (!result.ok) {
    throw new Error(
      `The event inside the supplied bundle does not satisfy the change-impact contract:\n  ${result.problems.join("\n  ")}`,
    );
  }
  return { read: () => normalize(result.event, sourceMode) };
}
