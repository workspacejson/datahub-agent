import {
  createAdapter,
  provisionalAdapter,
  provisionalStateAdapter,
  type CockpitSourceAdapter,
  type CockpitStateName,
} from "./cockpit-adapter";
import type { SourceEvent, SourceMode } from "../model/cockpit-view-model";

declare const __COCKPIT_SOURCE_MODE__: SourceMode;
/** The build-time event, or null in a placeholder build. See `vite.config.ts`. */
declare const __COCKPIT_EVENT__: unknown;
/**
 * The build-time comparison, already validated against the event above, or null
 * when no bundle was bound. See `vite.config.ts`.
 */
declare const __COCKPIT_COMPARISON__: SourceEvent["planComparison"] | null;

/**
 * Which adapter a build renders through.
 *
 * Until 2026-07-29 this threw for every mode except `placeholder` — "a fixture
 * or live build requires a bound source adapter" — which made placeholder the
 * *only* runnable mode. That reads as a guard and was in fact the missing swap:
 * `createAdapter` already existed in `cockpit-adapter`,
 * and nothing supplied them an event.
 *
 * Both halves are here on purpose, because only one of them is obvious.
 *
 * 1. **Committed mode works.** The event arrives as a build-time constant
 *    so a judge needs no GMS, no network and no file server, and a build that
 *    cannot find its event fails where the message is readable.
 *
 * 2. **Placeholder cannot reach a judge.** That belongs to HAC-226's acceptance
 *    rather than the swap's, and landing the first half without it would leave
 *    invented values reachable on the route a judge takes — the same inversion,
 *    pointed the other way.
 *
 * The second half is enforced in three places, and they fail at different times
 * on purpose:
 *
 *   build     `vite.config.ts` refuses `COCKPIT_SOURCE_MODE=placeholder` for a
 *             production build. Earliest and cheapest.
 *   selection here — a non-placeholder mode never returns the provisional
 *             adapter, and cannot silently fall back to it.
 *   model     `cockpitViewModelSchema` refuses a non-placeholder model carrying
 *             placeholder values, whichever adapter produced it. Last line, and
 *             the one that holds even if a future adapter invents values without
 *             going through the single provisional module. (Named indirectly:
 *             `architecture-invariants` counts any file mentioning that module
 *             by name as an importer of it, and a comment is not an import.)
 *
 * Parameters default to the build-time constants rather than reading them
 * directly, so both modes are reachable from a test. A module whose behaviour is
 * decided by a `define` is a module with one testable branch, and this one has
 * three.
 */
export function selectCockpitAdapter(
  mode: SourceMode = __COCKPIT_SOURCE_MODE__,
  event: unknown = __COCKPIT_EVENT__,
  planComparison: SourceEvent["planComparison"] | null = __COCKPIT_COMPARISON__,
): CockpitSourceAdapter {
  if (mode === "placeholder") return provisionalAdapter;

  if (event === null || event === undefined) {
    throw new Error(
      `A ${mode} build renders a committed event and none was bound. ` +
      "Set COCKPIT_EVENT to a change-impact event, or build with COCKPIT_SOURCE_MODE=placeholder. " +
      "No fallback evidence is invented.",
    );
  }

  // Throws, with the offending contract paths, if the event does not satisfy the
  // schema *and* the invariants. A cockpit that rendered an unvalidated event
  // would be showing a judge claims nothing stands behind.
  return createAdapter(event, mode, planComparison);
}

/**
 * The shell-only state harness, for exercising each rendered state in dev.
 *
 * It is not a way around the rule above: outside placeholder mode it delegates
 * to `selectCockpitAdapter` and gets the real event, so a committed build
 * cannot reach the invented states by asking for one by name.
 */
export function selectCockpitStateAdapter(state: CockpitStateName): CockpitSourceAdapter {
  return __COCKPIT_SOURCE_MODE__ === "placeholder"
    ? provisionalStateAdapter(state)
    : selectCockpitAdapter();
}
