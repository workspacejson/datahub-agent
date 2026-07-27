import { createAdapter, provisionalAdapter, type CockpitSourceAdapter } from "./cockpit-adapter";

declare const __COCKPIT_SOURCE_MODE__: "placeholder" | "fixture" | "live";

const unavailableLiveEvent = {
  route: "impact",
  source: "unavailable",
  read: "not-queried",
  completeness: "not-established",
  resolutionDisposition: "unavailable",
  mutationAcceptance: "not-attempted",
  intendedStateObservation: "not-attempted",
  terminalWritebackDisposition: "not-applicable",
  title: "Evidence source unavailable",
  summary: "Live evidence has not been connected.",
  unresolvedItems: [],
} as const;

export function selectCockpitAdapter(): CockpitSourceAdapter {
  if (__COCKPIT_SOURCE_MODE__ === "placeholder") return provisionalAdapter;
  return createAdapter(unavailableLiveEvent, __COCKPIT_SOURCE_MODE__);
}
