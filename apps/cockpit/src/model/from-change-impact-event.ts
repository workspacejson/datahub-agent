/**
 * The seam between the frozen evidence contract and what the cockpit renders.
 *
 * Before this existed, `createAdapter` took `unknown` and cast it to
 * `SourceEvent`. The cast was the contract: nothing checked that a real
 * `ChangeImpactEvent` could produce a view model, and nothing would have failed
 * if the two shapes diverged. The cockpit's view model was a third independent
 * definition of the same data — the interfaces and the schema guard each other,
 * and this side guarded nothing.
 *
 * Two rules hold here:
 *
 * 1. **Every mapping is total.** The `satisfies Record<...>` tables below stop
 *    compiling if the contract adds a case, rather than silently falling
 *    through to a default that reads as a real answer.
 *
 * 2. **Nothing is invented.** Where the event does not carry something the view
 *    would like, the projection says so. A cockpit that fabricates a plausible
 *    value is the failure this whole contract exists to prevent, moved to the
 *    last place anyone would look for it.
 */

import {
  describeTier,
  emittedEventSchema,
  type ChangeImpactEvent,
  type WorkspaceIntegrity,
} from "@contract";

import type {
  ClaimSource,
  CockpitRoute,
  EvidenceValue,
  SourceEvent,
} from "./cockpit-view-model";

/**
 * Contract completeness needs no translation, and that is the point.
 *
 * A `COMPLETENESS` table used to live here, mapping the contract's
 * `verified | unverified` onto the cockpit's
 * `complete-against-pinned-manifest | not-established`. The cockpit's words were
 * the better ones — they name what the claim was checked against instead of
 * grading it — but keeping them on one side of a seam meant the codebase held
 * two vocabularies for one axis, and the weaker pair stayed in the artifact a
 * judge actually receives.
 *
 * HAC-146 moved the better words into the contract itself, so the mapping became
 * the identity function and was deleted rather than left as a no-op. The types
 * are now the same type; drift is a compile error at the assignment, which is
 * strictly stronger than a table that would have happily kept translating.
 */

/**
 * How far the workspace artifact got, as a resolution disposition.
 *
 * The refusals are not collapsed into one bucket. "Wrong repository" and
 * "ambiguous path" are different findings with different fixes, and flattening
 * them would tell a reviewer only that something went wrong.
 */
const DISPOSITION: Record<WorkspaceIntegrity, SourceEvent["resolutionDisposition"]> = {
  "exact-match": "resolved",
  "artifact-unavailable": "unavailable",
  "repository-mismatch": "mismatch",
  "revision-mismatch": "mismatch",
  "path-unresolved": "partial",
  "path-ambiguous": "partial",
} satisfies Record<WorkspaceIntegrity, SourceEvent["resolutionDisposition"]>;

/** Whether the joined half of the thesis actually contributed anything. */
function attribution(event: ChangeImpactEvent): SourceEvent["source"] {
  const fromWorkspace = event.partners.length > 0
    || event.evidence.records.some((r) => r.source === "workspacejson");
  const fromCatalog = event.evidence.records.some((r) => r.source === "datahub")
    || event.datahub.name !== null;
  if (fromWorkspace && fromCatalog) return "Joined";
  if (fromCatalog) return "DataHub";
  if (fromWorkspace) return "workspace.json";
  return "unavailable";
}

/**
 * Lineage edges as impact rows.
 *
 * An edge that was observed is `resolved` — the read returned it. Whether the
 * *set* is complete is the `completeness` axis, carried separately, exactly as
 * the contract keeps them apart.
 */
function impactEdges(event: ChangeImpactEvent): SourceEvent["impactEdges"] {
  const directed = (kind: "upstream" | "downstream") =>
    (kind === "upstream" ? event.datahub.upstreams : event.datahub.downstreams).map((edge) => ({
      label: `${kind}: ${edge.name ?? edge.urn}`,
      state: "resolved" as const,
      reason: `Observed at degree ${edge.degree} by the catalog lineage read.`,
      source: "DataHub" as const,
    }));

  const edges = [...directed("upstream"), ...directed("downstream")];
  if (edges.length > 0) return edges;

  // Zero edges is not "no impact". The unavailable entry the contract requires
  // for an empty collection carries the reason, so it is shown rather than an
  // empty list that reads as a finding.
  const stated = event.unavailable.find((u) => u.field.startsWith("datahub."));
  return [{
    label: "No lineage edges were observed",
    state: "unresolved" as const,
    reason: stated?.detail
      ?? "The lineage read returned nothing and its completeness was not established.",
    source: "unavailable" as const,
  }];
}

/**
 * Project a validated event onto what the cockpit renders.
 *
 * `planDeltas` is deliberately empty. The event contract carries evidence, not
 * a plan — the DataHub-only/joined comparison is HAC-218's surface, and
 * synthesising a delta here would put an invented claim on the one screen whose
 * job is to show a real one.
 *
 * The `receipt` is projected here, under the contract's own accounting
 * vocabulary, and every field the event does not carry is `unavailable` with a
 * reason rather than a plausible string. HAC-226 replaces those stated absences
 * with observed evidence; nothing here needs to change for it to.
 */
/** An observation, tagged with the system that made it. */
const observed = (value: string, source: ClaimSource): EvidenceValue =>
  ({ state: "observed", value, source });

/** An absence, stating which absence it is. Never an empty string. */
const missing = (reason: string): EvidenceValue => ({ state: "unavailable", reason });

/** `observed` when the event carries the value, `unavailable` with the reason when it does not. */
function fromNullable(value: string | null | undefined, source: ClaimSource, reason: string): EvidenceValue {
  return value ? observed(value, source) : missing(reason);
}

/**
 * The receipt, projected from the event under the contract's vocabulary.
 *
 * Nothing here is derived, summed across denominators, or filled in. Where the
 * event does not carry a field, the receipt says so and says why — which is the
 * only rendering of an absence a judge can act on, and the only one HAC-226 can
 * later replace without a component change.
 *
 * Subject corpus identity is tagged `Joined`. It is not a claim either system
 * made alone: it is the key the two are compared on, and every workspace-derived
 * claim on the event is gated on it matching the artifact's own identity.
 */
function projectReceipt(event: ChangeImpactEvent): SourceEvent["receipt"] {
  const artifact = event.provenance.workspaceArtifact;
  const noArtifact = "No workspace.json artifact was supplied with this event, so the artifact side of the join has no identity to report.";
  // Digests and query parameters live on `VerificationEvidence`, which the
  // contract attaches only to a completeness claim it can back. An unverified
  // read carries neither, and inventing one would be asserting an attestation
  // that was never made.
  const verification = event.datahub.lineageObservation.upstreams.verification
    ?? event.datahub.lineageObservation.downstreams.verification;
  const noVerification = "The lineage read did not establish completeness, so the contract carries no attestation digests for it.";

  const capabilityLimits = event.unavailable
    .filter((u) => u.reason === "not-exposed-by-source")
    .map((u) => `${u.field}: ${u.detail}`);

  return {
    accounting: {
      datasetsRequested: event.accounting.datasetsRequested,
      datasetsResolved: event.accounting.datasetsResolved,
      datasetsUnresolved: event.accounting.datasetsUnresolved,
      nodesDropped: event.accounting.nodesDropped,
      nodesExcluded: { ...event.accounting.nodesExcluded },
    },
    // The contract carries the count without the names. Zero unresolved is the
    // one case where the empty list is the complete list.
    unresolvedDatasets: event.accounting.datasetsUnresolved === 0
      ? { state: "observed", names: [] }
      : {
        state: "unavailable",
        reason: `${event.accounting.datasetsUnresolved} dataset(s) went unresolved. The event records the count; it does not carry per-dataset names, and none are invented here.`,
      },
    statedGaps: event.unavailable.map((u) => ({ field: u.field, reason: u.reason, detail: u.detail })),
    provenance: {
      subjectRepository: fromNullable(event.provenance.corpus.repository, "Joined", "The event states no subject repository, so no workspace claim on it can be checked."),
      subjectRevision: fromNullable(event.provenance.corpus.commit, "Joined", "The event states no subject revision, so no claim about it is revision-bound."),
      artifactRepository: fromNullable(artifact?.repository, "workspace.json", noArtifact),
      artifactRevision: fromNullable(artifact?.revision, "workspace.json", noArtifact),
      producerVersion: fromNullable(artifact?.producedBy, "workspace.json", noArtifact),
      algorithmVersion: observed(`${event.provenance.producer.name}@${event.provenance.producer.version}`, "Joined"),
      inputDigest: verification
        ? observed(verification.expectedSetDigest, "Joined")
        : missing(noVerification),
      artifactDigest: verification
        ? observed(verification.manifestDigest, "Joined")
        : missing(noVerification),
      dataHubReadParameters: verification
        ? observed(JSON.stringify(verification.queryParameters), "DataHub")
        : observed(`gms ${event.provenance.datahub.gmsUrl} (${event.provenance.datahub.gmsVersion ?? "version not reported"})`, "DataHub"),
      producerPath: fromNullable(event.code.repositoryRelativePath, "workspace.json", `The producing file was not resolved to a repository path (method: ${event.code.method}).`),
      immutableSourceUrl: fromNullable(event.code.sourceUrl, "DataHub", "The official DataHub MCP projection drops Dataset.externalUrl, so no commit-pinned URL is available. No link is offered rather than one that could drift."),
      limitations: capabilityLimits.length > 0
        ? observed(capabilityLimits.join(" · "), "Joined")
        : missing("The event records no source-capability limitation."),
    },
    // The writeback receipt is produced by HAC-149 and attached to the event as
    // the documented `writeback` extension; binding and rendering it is HAC-226.
    // Until then this states that nothing was read rather than implying that
    // nothing happened, and the axes stay `not-attempted` so no terminal
    // disposition can be inferred from a surface that has not read one.
    writeback: {
      intent: missing("The writeback receipt is not bound into the cockpit yet, so no intent is shown."),
      beforeState: missing("The writeback receipt is not bound into the cockpit yet, so no before-state is shown."),
      mutationResponse: "not-attempted",
      afterStateRead: "not-queried",
      bothStatesRead: false,
      afterStateFreshness: "not-read",
      intendedStateObservation: "not-attempted",
      terminalDisposition: "not-applicable",
    },
    evaluation: {
      pairedSpread: missing("The paired DataHub-only vs joined evaluation has not been run."),
      locBaseline: missing("No lines-of-code baseline has been measured."),
      limitations: observed(
        `${event.unavailable.length} stated gap(s); ${describeTier(event.evidence.records)}.`,
        "Joined",
      ),
      // The event itself, verbatim. Not a summary and not a claim about it —
      // the bytes a reviewer would check every other line of this receipt against.
      rawEvidence: observed(JSON.stringify(event, null, 2), "Joined"),
    },
  };
}

export function projectEvent(event: ChangeImpactEvent, route: CockpitRoute): SourceEvent {
  const upstream = event.datahub.lineageObservation.upstreams;
  const artifact = event.provenance.workspaceArtifact;

  const producerPath = event.code.repositoryRelativePath;
  const partnerSummary = event.partners.length > 0
    ? `${event.partners.length} co-changing file(s) from repository evidence`
    : event.unavailable.find((u) => u.field === "partners")?.detail
      ?? "No repository co-change evidence was read.";

  return {
    route,
    source: attribution(event),
    read: upstream.read,
    completeness: upstream.completeness,
    resolutionDisposition: artifact ? DISPOSITION[artifact.integrity] : "unavailable",
    // The writeback axes are owned by HAC-219, which binds the receipt. Until
    // then this states that nothing was attempted rather than implying success.
    mutationAcceptance: "not-attempted",
    intendedStateObservation: "not-attempted",
    terminalWritebackDisposition: "not-applicable",
    title: event.datahub.name ?? event.subject.urn,
    summary: `${describeTier(event.evidence.records)}; ${event.unavailable.length} stated gap(s).`,
    unresolvedItems: event.unavailable.map((u) => `${u.field}: ${u.reason}`),
    datasetIdentity: { text: event.subject.urn, source: "DataHub" },
    producerPath: {
      text: producerPath ?? "Producer file was not resolved.",
      source: "workspace.json",
    },
    repositoryEvidence: { text: partnerSummary, source: "workspace.json" },
    // Null when the catalog exposes no commit-pinned URL. Rendering a
    // fabricated or branch-relative link would be a claim the event does not
    // support — see the note on `immutableViewSourceUrl` in the view model.
    immutableViewSourceUrl: event.code.sourceUrl,
    impactEdges: impactEdges(event),
    planDeltas: [],
    receipt: projectReceipt(event),
  };
}

/**
 * Parse an event against the frozen contract, then project it.
 *
 * Returns problems rather than throwing, and returns *the contract's* problems
 * — so a cockpit refusing to render says which field of which event was wrong,
 * in the same words the emitter and the receipt use.
 *
 * Parses `emittedEventSchema`, not `changeImpactEventSchema`. The pure contract
 * is `.strict()` and rejects the documented `writeback` extension outright,
 * which every golden fixture in this repository carries — so the cockpit
 * refused, with `Unrecognized key: "writeback"`, exactly the events a fixture
 * or live build exists to render. Measured, not inferred: parsing
 * `test/fixtures/golden/change-impact-event.nested.json` against the strict
 * schema fails on that key alone.
 */
export function readChangeImpactEvent(
  input: unknown,
  route: CockpitRoute,
): { ok: true; event: SourceEvent } | { ok: false; problems: string[] } {
  const parsed = emittedEventSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => {
        const path = issue.path.join(".") || "(root)";
        const absent = issue.code === "invalid_type" && issue.message.endsWith("received undefined");
        return absent ? `${path}: is missing` : `${path}: ${issue.message}`;
      }),
    };
  }
  return { ok: true, event: projectEvent(parsed.data as ChangeImpactEvent, route) };
}
