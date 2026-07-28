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
  unresolvedItems: ["<unresolved item>"],
  datasetIdentity: { text: "<dataset identity unavailable>", source: "DataHub" },
  producerPath: { text: "<producer path unavailable>", source: "workspace.json" },
  repositoryEvidence: { text: "<repository evidence unavailable>", source: "workspace.json" },
  immutableViewSourceUrl: "https://example.invalid/evidence-binding-pending",
  impactEdges: [{ label: "<lineage read not observed>", state: "unresolved", reason: "Completeness is not established; zero edges does not prove absence.", source: "unavailable" }],
  planDeltas: [{ kind: "uncertainty-changed", label: "<joined plan unavailable>", reason: "Evidence binding is pending; no semantic plan change is claimed.", source: "Joined" }],
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
