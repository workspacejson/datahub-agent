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

function normalize(event: SourceEvent, sourceMode: SourceMode): CockpitViewModel {
  return cockpitViewModelSchema.parse({ ...event, sourceMode });
}

/** The sole importer of provisional-source. Replace this adapter as a whole. */
export const provisionalAdapter: CockpitSourceAdapter = {
  read: () => normalize({
    ...provisionalSource,
    unresolvedItems: [...provisionalSource.unresolvedItems],
    impactEdges: provisionalSource.impactEdges.map((edge) => ({ ...edge })),
    planDeltas: provisionalSource.planDeltas.map((delta) => ({ ...delta })),
    read: "not-queried",
    completeness: "not-established",
    resolutionDisposition: "partial",
    mutationAcceptance: "not-attempted",
    intendedStateObservation: "not-attempted",
    terminalWritebackDisposition: "not-applicable",
  }, "placeholder"),
};

/** The shell-only harness deliberately exposes normalized, whole-model states. */
export function provisionalStateAdapter(state: CockpitStateName): CockpitSourceAdapter {
  const stateEvent = provisionalStates[state] as unknown as Partial<SourceEvent>;
  return {
    read: () => normalize({
      ...stateEvent,
      unresolvedItems: [...(stateEvent.unresolvedItems ?? [])],
      mutationAcceptance: stateEvent.mutationAcceptance ?? "not-attempted",
      intendedStateObservation: stateEvent.intendedStateObservation ?? "not-attempted",
      terminalWritebackDisposition: stateEvent.terminalWritebackDisposition ?? "not-applicable",
    } as SourceEvent, "placeholder"),
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

export function fixtureLiveParity(fixture: CockpitViewModel, live: CockpitViewModel): boolean {
  const { sourceMode: _fixtureMode, ...fixtureComparable } = fixture;
  const { sourceMode: _liveMode, ...liveComparable } = live;
  return JSON.stringify(fixtureComparable) === JSON.stringify(liveComparable);
}
