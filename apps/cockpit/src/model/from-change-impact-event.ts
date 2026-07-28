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
  changeImpactEventSchema,
  type ChangeImpactEvent,
  type Completeness,
  type WorkspaceIntegrity,
} from "@contract";

import type {
  CockpitRoute,
  SourceEvent,
} from "./cockpit-view-model";

/**
 * Contract completeness in the cockpit's words.
 *
 * The two vocabularies differ deliberately: `verified` is what the evidence
 * layer calls it, and a judge reading the screen is better served by naming
 * *what* it was verified against. They are the same axis, so the table is
 * exhaustive and a new contract value breaks the build here.
 */
const COMPLETENESS: Record<Completeness, SourceEvent["completeness"]> = {
  verified: "complete-against-pinned-manifest",
  unverified: "not-established",
} satisfies Record<Completeness, SourceEvent["completeness"]>;

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
 */
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
    completeness: COMPLETENESS[upstream.completeness],
    resolutionDisposition: artifact ? DISPOSITION[artifact.integrity] : "unavailable",
    // The writeback axes are owned by HAC-219, which binds the receipt. Until
    // then this states that nothing was attempted rather than implying success.
    mutationAcceptance: "not-attempted",
    intendedStateObservation: "not-attempted",
    terminalWritebackDisposition: "not-applicable",
    title: event.datahub.name ?? event.subject.urn,
    summary: `${event.evidence.tier} evidence from ${event.evidence.records.length} record(s); ${event.unavailable.length} stated gap(s).`,
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
  };
}

/**
 * Parse an event against the frozen contract, then project it.
 *
 * Returns problems rather than throwing, and returns *the contract's* problems
 * — so a cockpit refusing to render says which field of which event was wrong,
 * in the same words the emitter and the receipt use.
 */
export function readChangeImpactEvent(
  input: unknown,
  route: CockpitRoute,
): { ok: true; event: SourceEvent } | { ok: false; problems: string[] } {
  const parsed = changeImpactEventSchema.safeParse(input);
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
