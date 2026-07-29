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
  unresolvedItems: ["<unresolved item>: not-queried"],
  datasetIdentity: { text: "<dataset identity unavailable>", source: "DataHub" },
  producerPath: { text: "<producer path unavailable>", source: "workspace.json" },
  repositoryEvidence: { text: "<repository evidence unavailable>", source: "workspace.json" },
  // This was `https://example.invalid/evidence-binding-pending`. That domain is
  // RFC 2606 reserved and can never resolve, so it was not a working link — but
  // that was never the problem. A URL-shaped string reads as a link whether or
  // not it resolves, so it occupies the place where a reader looks for a source
  // and answers the question wrongly. Absence has to look like absence.
  viewSource: { state: "unavailable", reason: "evidence binding is pending; no corpus provenance is bound in placeholder mode" },
  impactEdges: [{ node: "<lineage read not observed>", direction: "none", degree: null, state: "unresolved", reason: "Completeness is not established; zero edges does not prove absence.", source: "unavailable" }],
  // Not a placeholder delta. This used to be one `uncertainty-changed` entry
  // labelled `<joined plan unavailable>`, which spelled an absence as a plan
  // change — the shape of a finding, carrying none. The state now says it
  // outright, so nothing has to read a label to learn no comparison exists.
  planComparison: { state: "unavailable", reason: "Evidence binding is pending; no comparison has been run, so no semantic plan change is claimed." },
  receipt: {
    // The contract's own accounting vocabulary. Datasets and dbt nodes are
    // separate denominators and are never summed; only `resolved + unresolved =
    // requested` is asserted, which is the arithmetic `validateEvent` enforces.
    accounting: { datasetsRequested: 1, datasetsResolved: 0, datasetsUnresolved: 1, nodesDropped: 0, nodesExcluded: {} },
    unresolvedDatasets: {
      state: "observed",
      records: [{ urn: "<unresolved dataset>", reason: "<reason unavailable in placeholder mode>" }],
    },
    statedGaps: [{ field: "<unresolved item>", reason: "not-queried", detail: "Evidence binding is pending; nothing was read for this field." }],
    provenance: {
      subjectRepository: { state: "placeholder", value: "<subject repository>" },
      subjectRevision: { state: "placeholder", value: "<subject revision>" },
      artifactRepository: { state: "placeholder", value: "<artifact repository>" },
      artifactRevision: { state: "placeholder", value: "<artifact revision>" },
      producerVersion: { state: "placeholder", value: "<producer version>" },
      algorithmVersion: { state: "placeholder", value: "<algorithm version>" },
      inputDigest: { state: "placeholder", value: "<input digest>" },
      artifactDigest: { state: "placeholder", value: "<artifact digest>" },
      dataHubReadParameters: { state: "placeholder", value: "<DataHub parameters>" },
      producerPath: { state: "placeholder", value: "<producer path>" },
      immutableSourceUrl: { state: "placeholder", value: "<immutable source URL>" },
      limitations: { state: "placeholder", value: "<limitations>" },
    },
    writeback: { intent: { state: "placeholder", value: "<intent>" }, beforeState: { state: "placeholder", value: "<before state>" }, mutationResponse: "not-attempted", afterStateRead: "not-queried", bothStatesRead: false, afterStateFreshness: "not-read", intendedStateObservation: "not-attempted", terminalDisposition: "not-applicable", beforeMatchedIntent: false },
    evaluation: {
      pairedSpread: { state: "placeholder", value: "<paired spread>" },
      locBaseline: { state: "placeholder", value: "<LOC baseline>" },
      limitations: { state: "placeholder", value: "<evaluation limitations>" },
      rawEvidence: { state: "placeholder", value: "<raw evidence>" },
    },
  },
} as const;

/**
 * Every deliberately invented state stays here. The adapter normalizes these
 * values before a component can receive them; views never select raw fields.
 */
export const provisionalStates = {
  loading: { ...provisionalSource, read: "not-queried", completeness: "not-established", resolutionDisposition: "indeterminate" },
  unavailable: { ...provisionalSource, source: "unavailable", read: "not-queried", completeness: "not-established", resolutionDisposition: "unavailable" },
  partial: { ...provisionalSource, read: "ok", completeness: "not-established", resolutionDisposition: "indeterminate" },
  // The artifact describes the file more than once and the join cannot single
  // it out. Unreachable before the ratified axis existed: it collapsed into
  // `partial` alongside "no candidate at all". HAC-218 requires an ambiguous
  // source among its rendered states.
  ambiguous: { ...provisionalSource, read: "ok", completeness: "not-established", resolutionDisposition: "ambiguous" },
  indeterminate: { ...provisionalSource, read: "ok", completeness: "not-established", resolutionDisposition: "indeterminate", terminalWritebackDisposition: "indeterminate", receipt: { ...provisionalSource.receipt, writeback: { ...provisionalSource.receipt.writeback, terminalDisposition: "indeterminate" } } },
  contradictory: { ...provisionalSource, read: "ok", completeness: "not-established", resolutionDisposition: "mismatch", terminalWritebackDisposition: "contradictory", receipt: { ...provisionalSource.receipt, writeback: { ...provisionalSource.receipt.writeback, terminalDisposition: "contradictory" } } },
  error: { ...provisionalSource, source: "DataHub", read: "failed", completeness: "not-established", resolutionDisposition: "unavailable" },
  "accepted-not-observed": {
    ...provisionalSource, read: "ok", completeness: "not-established", resolutionDisposition: "exact",
    mutationAcceptance: "accepted", intendedStateObservation: "not-observed", terminalWritebackDisposition: "accepted-not-observed", receipt: { ...provisionalSource.receipt, writeback: { ...provisionalSource.receipt.writeback, mutationResponse: "accepted", intendedStateObservation: "not-observed", terminalDisposition: "accepted-not-observed" } },
  },
  success: {
    ...provisionalSource, read: "ok", completeness: "complete-against-pinned-manifest", resolutionDisposition: "exact",
    mutationAcceptance: "accepted", intendedStateObservation: "observed", terminalWritebackDisposition: "success", receipt: { ...provisionalSource.receipt, writeback: { ...provisionalSource.receipt.writeback, mutationResponse: "accepted", afterStateRead: "ok", bothStatesRead: true, afterStateFreshness: "fresh", intendedStateObservation: "observed", terminalDisposition: "success" } },
  },
} as const satisfies Record<import("../model/cockpit-view-model").CockpitStateName, Record<string, unknown>>;
