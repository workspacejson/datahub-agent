/**
 * The only module permitted to contain invented values. It is deliberately
 * boring: downstream views receive the normalized model, never this fixture.
 */
export const provisionalSource = {
  source: "Joined",
  route: "impact",
  state: "partial",
  title: "<catalogued asset>",
  summary: "<evidence binding pending>",
  unresolvedItems: ["<unresolved item>"]
} as const;

/**
 * Every deliberately invented state stays here. The adapter normalizes these
 * values before a component can receive them; views never select raw fields.
 */
export const provisionalStates = {
  loading: { ...provisionalSource, read: "not-queried", completeness: "not-established", resolutionDisposition: "partial" },
  unavailable: { ...provisionalSource, source: "unavailable", read: "not-queried", completeness: "not-established", resolutionDisposition: "unavailable" },
  partial: { ...provisionalSource, read: "ok", completeness: "not-established", resolutionDisposition: "partial" },
  contradictory: { ...provisionalSource, read: "ok", completeness: "not-established", resolutionDisposition: "mismatch" },
  error: { ...provisionalSource, source: "DataHub", read: "failed", completeness: "not-established", resolutionDisposition: "unavailable" },
  "accepted-not-observed": {
    ...provisionalSource, read: "ok", completeness: "not-established", resolutionDisposition: "resolved",
    mutationAcceptance: "accepted", intendedStateObservation: "not-observed", terminalWritebackDisposition: "accepted-not-observed",
  },
  success: {
    ...provisionalSource, read: "ok", completeness: "complete-against-pinned-manifest", resolutionDisposition: "resolved",
    mutationAcceptance: "accepted", intendedStateObservation: "observed", terminalWritebackDisposition: "success",
  },
} as const satisfies Record<import("../model/cockpit-view-model").CockpitStateName, Record<string, unknown>>;
