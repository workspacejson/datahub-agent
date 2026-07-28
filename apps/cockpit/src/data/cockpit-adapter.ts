import { provisionalSource, provisionalStates } from "./provisional-source";
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

/** Live integration will replace its event transport, not view fields. */
export function createAdapter(event: unknown, sourceMode: Exclude<SourceMode, "placeholder">): CockpitSourceAdapter {
  return { read: () => normalize(event as SourceEvent, sourceMode) };
}

export function fixtureLiveParity(fixture: CockpitViewModel, live: CockpitViewModel): boolean {
  const { sourceMode: _fixtureMode, ...fixtureComparable } = fixture;
  const { sourceMode: _liveMode, ...liveComparable } = live;
  return JSON.stringify(fixtureComparable) === JSON.stringify(liveComparable);
}
