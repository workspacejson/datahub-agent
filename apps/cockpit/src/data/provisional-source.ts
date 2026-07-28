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
  receipt: {
    accounting: { total: 1, kept: 0, dropped: 0, excluded: 0, unresolved: 1 }, unresolvedItems: ["<unresolved item>"],
    provenance: { subjectRepository: "<subject repository>", subjectRevision: "<subject revision>", artifactRepository: "<artifact repository>", artifactRevision: "<artifact revision>", producerVersion: "<producer version>", algorithmVersion: "<algorithm version>", inputDigest: "<input digest>", artifactDigest: "<artifact digest>", dataHubReadParameters: "<DataHub parameters>", producerPath: "<producer path>", immutableSourceUrl: "https://example.invalid/evidence-binding-pending", limitations: "<limitations>", source: "Joined" },
    writeback: { intent: "<intent>", beforeState: "<before state>", mutationResponse: "not-attempted", afterStateRead: "not-queried", bothStatesRead: false, afterStateFreshness: "not-read", intendedStateObservation: "not-attempted", terminalDisposition: "not-applicable" },
    evaluation: { pairedSpread: "<paired spread>", locBaseline: "<LOC baseline>", limitations: "<evaluation limitations>", rawEvidence: "<raw evidence unavailable>" },
  },
} as const;

/**
 * Every deliberately invented state stays here. The adapter normalizes these
 * values before a component can receive them; views never select raw fields.
 */
export const provisionalStates = {
  loading: { ...provisionalSource, read: "not-queried", completeness: "not-established", resolutionDisposition: "partial" },
  unavailable: { ...provisionalSource, source: "unavailable", read: "not-queried", completeness: "not-established", resolutionDisposition: "unavailable" },
  partial: { ...provisionalSource, read: "ok", completeness: "not-established", resolutionDisposition: "partial" },
  indeterminate: { ...provisionalSource, read: "ok", completeness: "not-established", resolutionDisposition: "partial", terminalWritebackDisposition: "indeterminate", receipt: { ...provisionalSource.receipt, writeback: { ...provisionalSource.receipt.writeback, terminalDisposition: "indeterminate" } } },
  contradictory: { ...provisionalSource, read: "ok", completeness: "not-established", resolutionDisposition: "mismatch", terminalWritebackDisposition: "contradictory", receipt: { ...provisionalSource.receipt, writeback: { ...provisionalSource.receipt.writeback, terminalDisposition: "contradictory" } } },
  error: { ...provisionalSource, source: "DataHub", read: "failed", completeness: "not-established", resolutionDisposition: "unavailable" },
  "accepted-not-observed": {
    ...provisionalSource, read: "ok", completeness: "not-established", resolutionDisposition: "resolved",
    mutationAcceptance: "accepted", intendedStateObservation: "not-observed", terminalWritebackDisposition: "accepted-not-observed", receipt: { ...provisionalSource.receipt, writeback: { ...provisionalSource.receipt.writeback, mutationResponse: "accepted", intendedStateObservation: "not-observed", terminalDisposition: "accepted-not-observed" } },
  },
  success: {
    ...provisionalSource, read: "ok", completeness: "complete-against-pinned-manifest", resolutionDisposition: "resolved",
    mutationAcceptance: "accepted", intendedStateObservation: "observed", terminalWritebackDisposition: "success", receipt: { ...provisionalSource.receipt, writeback: { ...provisionalSource.receipt.writeback, mutationResponse: "accepted", afterStateRead: "ok", bothStatesRead: true, afterStateFreshness: "fresh", intendedStateObservation: "observed", terminalDisposition: "success" } },
  },
} as const satisfies Record<import("../model/cockpit-view-model").CockpitStateName, Record<string, unknown>>;
