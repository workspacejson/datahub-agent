/**
 * The frozen integration contract between the DataHub read path and everything
 * that consumes it — the demo path and the judge-facing cockpit.
 *
 * Two requirements drive the shape, and both are easy to get wrong:
 *
 * 1. **Every fact carries its origin.** The cockpit offers a DataHub-only /
 *    joined toggle, which is the comparison the whole project rests on. That is
 *    only reconstructable if each fact records which system produced it. A
 *    merged blob cannot be un-merged later.
 *
 * 2. **Absence is stated, never implied.** An empty lineage array must not be
 *    readable as "this dataset has no dependencies" — it may mean the query was
 *    not run, or failed, or that the catalog genuinely has no edges. Those are
 *    different claims and only one of them is evidence. Every consumer-visible
 *    absence appears in `unavailable` with a reason.
 *
 * The second point is the same discipline the dbt node extraction already
 * applies: a dropped node warns rather than vanishing. This applies it to
 * catalog context.
 */

/** Which system asserted a fact. Never inferred — always recorded at the source. */
export type ContextSource = "datahub" | "workspacejson";

/**
 * Why a piece of context is not present.
 *
 * `absent` is a positive claim: the system was asked and reported nothing.
 * `not-queried` and `failed` are not claims about the data at all. Collapsing
 * them is precisely the error this type exists to prevent.
 */
export type UnavailableReason =
  | "absent"
  | "not-queried"
  | "failed"
  | "not-exposed-by-source";

export interface Unavailable {
  /** Dotted path of what is missing, e.g. `datahub.lineage.downstreams`. */
  field: string;
  source: ContextSource;
  reason: UnavailableReason;
  /** Human-readable detail — shown to a reviewer, so it must stand alone. */
  detail: string;
}

/** How the dataset's producing file was determined. */
export type ResolutionMethod =
  /** Parsed from the catalog's own commit-pinned source URL. */
  | "external-url"
  /** dbt file path from catalog properties, normalized to repository-root. */
  | "dbt-file-path"
  /** Joined through a dbt manifest read outside the catalog. */
  | "manifest-join"
  | "unresolved";

export interface CodeResolution {
  dbtUniqueId: string | null;
  /** As the catalog reports it — relative to the dbt project, not the repo. */
  dbtFilePath: string | null;
  /**
   * Repository-root-relative POSIX path — the `fileIndex` key contract.
   * Null when it could not be derived; never guessed.
   */
  repositoryRelativePath: string | null;
  /** The offset between the two paths above. Empty string at the repo root. */
  projectPrefix: string | null;
  method: ResolutionMethod;
  /** Commit-pinned link, when the catalog exposes one. */
  sourceUrl: string | null;
}

export interface LineageEdge {
  urn: string;
  name: string | null;
  /** Hops from the subject. 1 is a direct dependency. */
  degree: number;
}

export interface DataHubContext {
  name: string | null;
  platform: string | null;
  description: string | null;
  /** Declared dependencies from the catalog — NOT behavioral coupling. */
  upstreams: LineageEdge[];
  downstreams: LineageEdge[];
  schemaFieldCount: number | null;
  owners: string[];
  domain: string | null;
}

/**
 * A file that changes alongside the producing file, per repository evidence.
 *
 * This is the axis DataHub structurally cannot supply: the catalog knows what
 * a dataset *depends on*, not what engineers *edit together*. Kept separate
 * from lineage so the cockpit can show the difference rather than blending two
 * kinds of claim into one list.
 */
export interface CodePartner {
  repositoryRelativePath: string;
  /** Plain language, shown directly to a reviewer. */
  reason: string;
  source: ContextSource;
}

/**
 * Evidence tier, a mechanical function of the records present — never a tuned
 * score. ASSERTED: claimed with no supporting record. OBSERVED: at least one
 * record. VERIFIED: at least one record whose check was actually executed.
 */
export type EvidenceTier = "ASSERTED" | "OBSERVED" | "VERIFIED";

export interface EvidenceRecord {
  claim: string;
  /** What was actually run or read to support the claim. */
  observation: string;
  source: ContextSource;
  /** True only when this harness executed the check itself. */
  verified: boolean;
}

/** Counts that must reconcile, so a reviewer can check the arithmetic. */
export interface ResolutionAccounting {
  datasetsRequested: number;
  datasetsResolved: number;
  datasetsUnresolved: number;
  /** Dataset-bearing dbt nodes with no source file. */
  nodesDropped: number;
  /** Nodes excluded by policy, by resource type. */
  nodesExcluded: Record<string, number>;
}

export interface Provenance {
  producedAt: string;
  producer: { name: string; version: string };
  datahub: { gmsUrl: string; gmsVersion: string | null };
  corpus: { repository: string | null; commit: string | null };
  /** Producer identity from the workspace.json artifact, when one was read. */
  workspaceArtifact: { producedBy: string | null; fileIndexKeys: number } | null;
}

export const CHANGE_IMPACT_EVENT_VERSION = "1.0" as const;

export interface ChangeImpactEvent {
  eventVersion: typeof CHANGE_IMPACT_EVENT_VERSION;
  provenance: Provenance;

  subject: { urn: string };
  datahub: DataHubContext;
  code: CodeResolution;
  /** Behavioral coupling — empty is meaningful only alongside `unavailable`. */
  partners: CodePartner[];

  evidence: { records: EvidenceRecord[]; tier: EvidenceTier };
  accounting: ResolutionAccounting;

  /**
   * Every absence a consumer could otherwise misread. An empty array is itself
   * a claim: nothing was missing.
   */
  unavailable: Unavailable[];
}

/**
 * Derive the tier from the records. Mechanical by construction — there is no
 * threshold to tune and no argument to pass that could override it.
 */
export function deriveTier(records: readonly EvidenceRecord[]): EvidenceTier {
  if (records.length === 0) return "ASSERTED";
  return records.some((r) => r.verified) ? "VERIFIED" : "OBSERVED";
}

/**
 * Reduce the event to what DataHub alone supports.
 *
 * This powers the cockpit's toggle, and it is the honest half of the
 * comparison: strip everything this project contributes and show what a
 * DataHub-only agent would have seen. Partners disappear, workspace.json-sourced
 * evidence disappears, and each removal is recorded in `unavailable` so the
 * absence reads as scoped rather than as an empty result.
 */
export function toDataHubOnly(event: ChangeImpactEvent): ChangeImpactEvent {
  const removedPartners = event.partners.length;
  const datahubRecords = event.evidence.records.filter((r) => r.source === "datahub");

  return {
    ...event,
    partners: [],
    evidence: { records: datahubRecords, tier: deriveTier(datahubRecords) },
    code:
      event.code.method === "manifest-join"
        ? { ...event.code, repositoryRelativePath: null, projectPrefix: null, method: "unresolved" }
        : event.code,
    unavailable: [
      ...event.unavailable,
      {
        field: "partners",
        source: "workspacejson",
        reason: "not-queried",
        detail:
          removedPartners > 0
            ? `${removedPartners} co-changing file(s) withheld: DataHub-only mode excludes repository evidence.`
            : "DataHub-only mode excludes repository evidence; no co-change is computed.",
      },
    ],
  };
}

/**
 * Check the invariants a consumer is entitled to rely on.
 *
 * Returns problems rather than throwing, so a caller can surface them in a
 * receipt instead of losing the event. An event that fails these is still
 * emitted — silently dropping it would be the failure mode this contract is
 * built to avoid.
 */
export function validateEvent(event: ChangeImpactEvent): string[] {
  const problems: string[] = [];

  if (event.eventVersion !== CHANGE_IMPACT_EVENT_VERSION) {
    problems.push(`unknown eventVersion ${event.eventVersion}`);
  }

  const { datasetsRequested, datasetsResolved, datasetsUnresolved } = event.accounting;
  if (datasetsResolved + datasetsUnresolved !== datasetsRequested) {
    problems.push(
      `accounting does not reconcile: ${datasetsResolved} resolved + ${datasetsUnresolved} unresolved != ${datasetsRequested} requested`,
    );
  }

  if (deriveTier(event.evidence.records) !== event.evidence.tier) {
    problems.push("evidence.tier is not the mechanical function of evidence.records");
  }

  // The core rule: an empty result must be accompanied by a stated reason.
  const emptyNeedsReason: Array<[unknown[], string]> = [
    [event.datahub.upstreams, "datahub.upstreams"],
    [event.datahub.downstreams, "datahub.downstreams"],
    [event.partners, "partners"],
  ];
  for (const [collection, field] of emptyNeedsReason) {
    if (collection.length === 0 && !event.unavailable.some((u) => u.field === field)) {
      problems.push(
        `${field} is empty with no entry in unavailable — a consumer cannot tell absence from failure`,
      );
    }
  }

  if (event.code.method === "unresolved" && event.code.repositoryRelativePath !== null) {
    problems.push("code.method is unresolved but a repositoryRelativePath is present");
  }

  return problems;
}
