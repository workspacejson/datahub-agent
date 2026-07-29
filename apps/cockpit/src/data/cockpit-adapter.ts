import { provisionalSource, provisionalStates } from "./provisional-source";
import { readChangeImpactEvent } from "../model/from-change-impact-event";
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

export function normalize(event: SourceEvent, sourceMode: SourceMode): CockpitViewModel {
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
 *
 * `planComparison` is optional and arrives **already validated**, from the build
 * step in `vite.config.ts`. It is not a way to hand the view an unchecked delta
 * list: proving that a comparison is bound to this event means recomputing the
 * event digest, `digestEvent` hashes with `node:crypto`, and Vite externalizes
 * that for the browser rather than failing the build — which is how a bundle
 * once built cleanly, passed every node-environment test, and then died on load.
 * So the check runs where the artifact is read, in Node, and only its result
 * crosses into the browser. Omitted, the event's own `unavailable` state stands,
 * which is the honest reading of an event supplied without a comparison.
 */
export function createAdapter(
  event: unknown,
  sourceMode: Exclude<SourceMode, "placeholder">,
  planComparison?: SourceEvent["planComparison"] | null,
): CockpitSourceAdapter {
  const result = readChangeImpactEvent(event, "impact");
  if (!result.ok) {
    throw new Error(
      `The supplied event does not satisfy the change-impact contract:\n  ${result.problems.join("\n  ")}`,
    );
  }
  const projected = planComparison ? { ...result.event, planComparison } : result.event;
  return { read: () => normalize(projected, sourceMode) };
}

export function fixtureLiveParity(fixture: CockpitViewModel, live: CockpitViewModel): boolean {
  const { sourceMode: _fixtureMode, ...fixtureComparable } = fixture;
  const { sourceMode: _liveMode, ...liveComparable } = live;
  return JSON.stringify(fixtureComparable) === JSON.stringify(liveComparable);
}
