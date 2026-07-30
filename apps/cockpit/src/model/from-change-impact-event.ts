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
  validateEvent,
  type ChangeImpactEvent,
  type WorkspaceIntegrity,
} from "@contract";

import { resolveViewSource } from "./view-source";
import { writebackAxes, type WritebackAxes } from "./writeback-axes";

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
  "exact-match": "exact",
  "artifact-unavailable": "unavailable",
  "repository-mismatch": "mismatch",
  "revision-mismatch": "mismatch",
  // Distinct, and they were not before. `path-unresolved` means the artifact
  // holds no candidate for the file; `path-ambiguous` means it holds several and
  // the join cannot single one out. Both used to arrive as `partial`, which told
  // a reviewer only that something went wrong — while the comment above claimed
  // the opposite. Different findings, different fixes, different words.
  "path-unresolved": "indeterminate",
  "path-ambiguous": "ambiguous",
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
  // `urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.base_games,PROD)`. Read
  // rather than inferred from the name shape, and null when absent.
  const platformOf = (urn: string) => /urn:li:dataPlatform:([^,)]+)/.exec(urn)?.[1] ?? null;

  const directed = (kind: "upstream" | "downstream") =>
    (kind === "upstream" ? event.datahub.upstreams : event.datahub.downstreams).map((edge) => ({
      node: edge.name ?? edge.urn,
      platform: platformOf(edge.urn),
      direction: kind,
      degree: edge.degree,
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
    node: "No lineage edges were observed",
    platform: null,
    direction: "none" as const,
    degree: null,
    state: "unresolved" as const,
    reason: stated?.detail
      ?? "The lineage read returned nothing and its completeness was not established.",
    source: "unavailable" as const,
  }];
}

/**
 * Project a validated event onto what the cockpit renders.
 *
 * `planComparison` is `unavailable` here, and says so in the reason rather than
 * rendering as an empty delta list. The event contract carries evidence, not a
 * plan: a comparison is a separate, separately-versioned artifact, and
 * synthesising a delta from an event alone would put an invented claim on the one
 * screen whose job is to show a real one. `projectBundle` below is the path that
 * produces an observed comparison, from a `JudgeRunBundle` that actually holds
 * one.
 *
 * The `receipt` is projected here, under the contract's own accounting
 * vocabulary, and every field the event does not carry is `unavailable` with a
 * reason rather than a plausible string. HAC-226 replaces those stated absences
 * with observed evidence; nothing here needs to change for it to.
 */
/**
 * Why a view built from an event alone has no comparison.
 *
 * Defined in `project-comparison.ts` and re-exported here so existing importers
 * keep their path. It moved because `vite.config.ts` needs the same sentence at
 * build time and cannot import this module: everything here reaches `@contract`,
 * and a Vite config resolves no app aliases while it is being compiled.
 */
export { NO_COMPARISON_SUPPLIED } from "./project-comparison";
import { NO_COMPARISON_SUPPLIED } from "./project-comparison";

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
function projectReceipt(event: ChangeImpactEvent, axes: WritebackAxes): SourceEvent["receipt"] {
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
    // Three cases, and the middle one is new. Zero unresolved is the case where
    // the empty list is the complete list. A producer that emitted
    // `unresolvedRecords` has named them, and the contract already refused the
    // event if that list disagreed with the count. Anything else predates
    // HAC-267's field and keeps the honest fallback — the count is recorded, the
    // names are not carried, and none are invented here.
    unresolvedDatasets: event.accounting.datasetsUnresolved === 0
      ? { state: "observed", records: [] }
      : event.accounting.unresolvedRecords
      ? {
        state: "observed",
        records: event.accounting.unresolvedRecords.map((record) => ({ urn: record.urn, reason: record.reason })),
      }
      : {
        state: "unavailable",
        reason: `${event.accounting.datasetsUnresolved} dataset(s) went unresolved. This event predates the accounting.unresolvedRecords field, so it records the count without per-dataset names, and none are invented here.`,
      },
    statedGaps: event.unavailable.map((u) => ({ field: u.field, source: u.source, reason: u.reason, detail: u.detail })),
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
    // Bound from the receipt HAC-149 attaches as the documented `writeback`
    // extension. This block and the top-level axes come from one derivation, so
    // the view model's "axes must match the receipt" invariant is a check rather
    // than the thing keeping them aligned. HAC-226 owns how this renders.
    writeback: axes.receipt,
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
  const axes = writebackAxes((event as { writeback?: unknown }).writeback);
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
    // Derived from the attached receipt rather than asserted. These were pinned
    // to `not-attempted` while HAC-219 was outstanding; HAC-219 has landed, so
    // saying "nothing was attempted" beside a completed mutation is no longer
    // caution, it is a false statement. See `writebackAxes`.
    mutationAcceptance: axes.mutationAcceptance,
    intendedStateObservation: axes.intendedStateObservation,
    terminalWritebackDisposition: axes.terminalWritebackDisposition,
    title: event.datahub.name ?? event.subject.urn,
    summary: `${describeTier(event.evidence.records)}; ${event.unavailable.length} stated gap(s).`,
    unresolvedItems: event.unavailable.map((u) => `${u.field}: ${u.reason}`),
    datasetIdentity: { text: event.subject.urn, source: "DataHub" },
    producerPath: {
      text: producerPath ?? "Producer file was not resolved.",
      source: "workspace.json",
    },
    dbtFilePath: event.code.dbtFilePath,
    projectPrefix: event.code.projectPrefix,
    repositoryEvidence: { text: partnerSummary, source: "workspace.json" },
    // Declared by the catalog when it says anything, constructed from recorded
    // provenance when it does not, and explicitly unavailable when neither is
    // possible. Never fabricated. See `resolveViewSource`.
    viewSource: resolveViewSource(event),
    impactEdges: impactEdges(event),
    planComparison: { state: "unavailable", reason: NO_COMPARISON_SUPPLIED },
    receipt: projectReceipt(event, axes),
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
 *
 * ## Two gates, not one
 *
 * A schema pass is a shape check. The contract's invariants are a separate
 * function, and until 2026-07-29 this path ran only the first — so an event
 * whose shape was right and whose *claims* contradicted the contract rendered
 * happily (HAC-242).
 *
 * That was not theoretical. `contract-event.ts`, the shared helper documented as
 * "shaped exactly as the emitter produces one", carried a `partners` entry
 * reading `reason: "absent"` with no `completeness` — which `validateEvent`
 * rejects, because absence is only sayable about an answer established complete
 * against a pinned manifest. Every cockpit test using that helper asserted
 * against an event the contract refuses, and nothing failed.
 *
 * The gap matters more now than when it was filed. `accounting.unresolvedRecords`
 * (HAC-267) is guarded by an invariant that a partial list is rejected — a list
 * of one beside a count of two reads as complete and is not. That guard lives in
 * `validateEvent`. Without this call it protects the emitter and the test suite
 * while the judge-facing surface renders the short list without complaint.
 *
 * Order matters: schema first. `validateEvent` takes `unknown` deliberately, but
 * its problems are legible only against a value already known to be shaped
 * right; a malformed blob should fail as malformed rather than producing a
 * cascade of invariant complaints about fields that are simply absent.
 *
 * Invariant problems carry an `invariant: ` prefix so the two kinds stay
 * distinguishable in one list. They call for different fixes — a shape failure
 * is a malformed producer, an invariant failure is a producer making a claim it
 * cannot support — and collapsing them costs the reader the diagnosis, which is
 * the same defect this contract exists to refuse. Shape problems keep their
 * `path: message` form; the field path is their signature.
 *
 * This tightens the *event* gate only. The comparison side deliberately fails
 * differently — an absent or invalid comparison reaches the view as
 * `unavailable` carrying its problems, because crashing loses the diagnosis and
 * rendering the survivors turns a partial artifact into a confident one. That
 * asymmetry is load-bearing and must not be "made consistent".
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

  const violations = validateEvent(parsed.data);
  if (violations.length > 0) {
    return { ok: false, problems: violations.map((problem) => `invariant: ${problem}`) };
  }

  return { ok: true, event: projectEvent(parsed.data as ChangeImpactEvent, route) };
}

