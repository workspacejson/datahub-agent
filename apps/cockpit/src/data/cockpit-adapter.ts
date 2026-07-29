import { provisionalSource, provisionalStates } from "./provisional-source";
import { readChangeImpactEvent, readJudgeRunBundle } from "../model/from-change-impact-event";
import {
  cockpitViewModelSchema,
  type CockpitViewModel,
  type SourceEvent,
  type SourceMode,
  type CockpitStateName,
} from "../model/cockpit-view-model";

export interface CockpitSourceAdapter {
  read(): CockpitViewModel;
}

export type { CockpitStateName } from "../model/cockpit-view-model";

function normalize(event: SourceEvent, sourceMode: SourceMode): CockpitViewModel {
  return cockpitViewModelSchema.parse({ ...event, sourceMode });
}

/**
 * `provisional-source` is `as const`, so every array and nested object in it is
 * readonly and shared between frames. One deep copy per read keeps a caller from
 * mutating the one module that is allowed to hold invented values — and replaces
 * a hand-written per-field clone that had to be extended every time the receipt
 * grew a section, which is a maintenance burden that fails silently.
 */
function detached(event: unknown): SourceEvent {
  return structuredClone(event) as SourceEvent;
}

/** The sole importer of provisional-source. Replace this adapter as a whole. */
export const provisionalAdapter: CockpitSourceAdapter = {
  read: () => normalize(detached({
    ...provisionalSource,
    read: "not-queried",
    completeness: "not-established",
    resolutionDisposition: "indeterminate",
    mutationAcceptance: "not-attempted",
    intendedStateObservation: "not-attempted",
    terminalWritebackDisposition: "not-applicable",
  }), "placeholder"),
};

/** The shell-only harness deliberately exposes normalized, whole-model states. */
export function provisionalStateAdapter(state: CockpitStateName): CockpitSourceAdapter {
  const stateEvent = provisionalStates[state] as unknown as Partial<SourceEvent>;
  return {
    read: () => normalize(detached({
      ...stateEvent,
      mutationAcceptance: stateEvent.mutationAcceptance ?? "not-attempted",
      intendedStateObservation: stateEvent.intendedStateObservation ?? "not-attempted",
      terminalWritebackDisposition: stateEvent.terminalWritebackDisposition ?? "not-applicable",
    }), "placeholder"),
  };
}

/**
 * Fixture and live events both enter here, and both are `ChangeImpactEvent`.
 *
 * This used to be `normalize(event as SourceEvent, sourceMode)`. The cast was
 * the only thing standing where a contract belonged: nothing checked that a real
 * event could produce a view model, and the two shapes could have diverged
 * indefinitely without a single failure. Now the event is parsed against the
 * frozen schema and projected, so an event the emitter can produce is an event
 * the cockpit can render — or the mismatch is named.
 *
 * Throws only on a contract violation, and the message carries the offending
 * paths. A cockpit that rendered a malformed event would be showing a judge
 * claims nothing stands behind.
 */
export function createAdapter(event: unknown, sourceMode: Exclude<SourceMode, "placeholder">): CockpitSourceAdapter {
  const result = readChangeImpactEvent(event, "impact");
  if (!result.ok) {
    throw new Error(
      `The supplied event does not satisfy the change-impact contract:\n  ${result.problems.join("\n  ")}`,
    );
  }
  return { read: () => normalize(result.event, sourceMode) };
}

/**
 * The path for a `JudgeRunBundle`: an event plus the comparison derived from it.
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

export function fixtureLiveParity(fixture: CockpitViewModel, live: CockpitViewModel): boolean {
  const { sourceMode: _fixtureMode, ...fixtureComparable } = fixture;
  const { sourceMode: _liveMode, ...liveComparable } = live;
  return JSON.stringify(fixtureComparable) === JSON.stringify(liveComparable);
}
