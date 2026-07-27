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
 *
 * `indeterminate` is the fourth case, and it exists because the other three
 * could not express it. The system was asked, it answered, and the answer
 * cannot be trusted to be complete — a search-backed lineage read against an
 * index that may still be converging is the case that forced it. Calling that
 * `absent` asserts the catalog has no edges; calling it `failed` asserts the
 * query did not work. Both are false. The query succeeded, returned what it
 * returned, and completeness is unknown.
 *
 * `indeterminate` is therefore about the *standing* of an answer, not its
 * content: an empty result and a partial one can both be indeterminate, and
 * whatever edges were returned remain evidence either way.
 */
export type UnavailableReason =
  | "absent"
  | "not-queried"
  | "failed"
  | "indeterminate"
  | "not-exposed-by-source";

/**
 * Whether an answer's completeness was established, as an axis of its own.
 *
 * Kept separate from whether the read succeeded, for the same reason the
 * writeback receipt keeps its observation status separate from `read`: a query
 * that succeeded while returning a possibly-partial answer is `ok` and
 * `unverified` at once, and one field cannot say both without losing the
 * distinction.
 *
 * `verified` requires an external attestation — an expected result the answer
 * was checked against. Repetition is not attestation: two identical samples do
 * not prove convergence, and neither does a long wait at zero. Nothing in a
 * general read path can upgrade `unverified` on its own.
 */
export type Completeness = "verified" | "unverified";

/**
 * What a `verified` completeness claim rests on.
 *
 * Required rather than optional, because a second axis with no evidence behind
 * it is merely a new place to assert the word "verified". The point of the axis
 * is to make completeness checkable; a bare enum would make it assertable.
 *
 * The digests are of sorted URN *sets*, not counts. Twelve edges can be the
 * wrong twelve, and a count that matches while the members differ is exactly
 * the failure a count-based oracle cannot see.
 */
export interface VerificationEvidence {
  /** Digest of the readiness manifest the expectation came from. */
  manifestDigest: string;
  /** Digest of the sorted expected URN set. */
  expectedSetDigest: string;
  /** Digest of the sorted observed URN set. */
  observedSetDigest: string;
  /**
   * Query surface, direction and hop parameters. Two sets are only comparable
   * under the same parameters, so recording them is part of the evidence rather
   * than commentary on it.
   */
  queryParameters: Record<string, string | number>;
}

export interface Unavailable {
  /** Dotted path of what is missing, e.g. `datahub.lineage.downstreams`. */
  field: string;
  source: ContextSource;
  reason: UnavailableReason;
  /** Human-readable detail — shown to a reviewer, so it must stand alone. */
  detail: string;
  /**
   * Whether the answer behind this entry was established as complete.
   *
   * Carried alongside `reason` rather than folded into it, because the two say
   * different things: `reason` is why the context is not present, and this is
   * how far the answer can be trusted. Omitted where completeness is not a
   * meaningful question — a field the source does not expose was never an
   * answer to begin with.
   */
  completeness?: Completeness;
  /**
   * What the query did return, when it returned something that is not being
   * presented as the whole answer. Zero is a real observation and is recorded
   * as one; it is `completeness` that says whether it can be read as absence.
   *
   * Only meaningful where a query ran. A failed or unqueried read has no count,
   * and manufacturing a zero for one would recreate the collapse this contract
   * exists to prevent, in the arithmetic instead of the vocabulary.
   */
  observedCount?: number;
  /** Required whenever `completeness` is `verified`. */
  verification?: VerificationEvidence;
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

/**
 * The standing of one direction of a lineage read.
 *
 * This lives beside the arrays rather than inside `unavailable`, and the
 * distinction is load-bearing. An `unavailable` entry is only required when a
 * collection is *empty*, so completeness carried there is unreachable in the
 * case that actually caused this: a partially converged index returning one
 * edge of twelve. The array is non-empty, nothing is "unavailable", and the
 * event would carry no completeness state at all — the original defect,
 * surviving inside its own fix.
 *
 * So every event states the standing of both directions, always, whether or not
 * anything is missing. `unavailable` stays what it is: the human explanation for
 * absent context, never the only machine-readable place completeness lives.
 */
export interface LineageObservation {
  /** Whether the catalog answered. Unless "ok", `observedCount` is not a claim. */
  read: "ok" | "failed" | "not-queried";
  /** Whether the answer was established as whole. Never derived from `read`. */
  completeness: Completeness;
  /** What the query returned. Absent when no query ran. */
  observedCount?: number;
  /** Required whenever `completeness` is `verified`. */
  verification?: VerificationEvidence;
}

export interface DataHubContext {
  name: string | null;
  platform: string | null;
  description: string | null;
  /** Declared dependencies from the catalog — NOT behavioral coupling. */
  upstreams: LineageEdge[];
  downstreams: LineageEdge[];
  /**
   * The standing of each lineage read, stated on every event. Mandatory
   * precisely because a partial answer looks like a complete one.
   */
  lineageObservation: {
    upstreams: LineageObservation;
    downstreams: LineageObservation;
  };
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
/**
 * A second axis with nothing behind it is just a new place to assert the word.
 * `verified` has to name what it was checked against, wherever it is claimed.
 */
function verifiedEvidenceProblems(
  holder: { completeness?: Completeness; verification?: VerificationEvidence },
  label: string,
): string[] {
  if (holder.completeness !== "verified") return [];
  const v = holder.verification;
  const missing = !v
    ? ["verification"]
    : (["manifestDigest", "expectedSetDigest", "observedSetDigest"] as const).filter((k) => !v[k]);
  if (!v || missing.length > 0 || Object.keys(v.queryParameters ?? {}).length === 0) {
    return [
      `${label} claims verified completeness without evidence (${missing.join(", ") || "queryParameters"})`,
    ];
  }
  return [];
}

export function validateEvent(event: ChangeImpactEvent): string[] {
  const problems: string[] = [];

  // Stated on every event, in both directions, whether or not anything is
  // missing — a partial answer is the case that looks like a complete one.
  for (const [direction, edges] of [
    ["upstreams", event.datahub.upstreams],
    ["downstreams", event.datahub.downstreams],
  ] as const) {
    const label = `datahub.lineageObservation.${direction}`;
    const observation = event.datahub.lineageObservation?.[direction];
    if (!observation) {
      problems.push(`${label} is missing — every event must state the standing of both directions`);
      continue;
    }

    problems.push(...verifiedEvidenceProblems(observation, label));

    if (observation.read === "ok") {
      if (observation.observedCount === undefined) {
        problems.push(`${label} read ok without an observedCount`);
      } else if (observation.observedCount !== edges.length) {
        problems.push(
          `${label} reports observedCount ${observation.observedCount} but carries ${edges.length} edges`,
        );
      }
    } else {
      if (observation.observedCount !== undefined) {
        problems.push(`${label} is ${observation.read} but carries an observedCount`);
      }
      if (edges.length > 0) {
        problems.push(`${label} is ${observation.read} but ${edges.length} edges are present`);
      }
      if (observation.completeness === "verified") {
        problems.push(`${label} claims verified completeness on a read that did not happen`);
      }
    }
  }

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

  // An `absent` claim asserts the source was asked and holds nothing. That is
  // only sayable on an answer known to be complete. A partially-converged index
  // returning zero edges is the case this exists for: it satisfies "asked and
  // got nothing" while being no evidence at all about the data.
  const observedCollections: Record<string, unknown[] | undefined> = {
    "datahub.upstreams": event.datahub.upstreams,
    "datahub.downstreams": event.datahub.downstreams,
    partners: event.partners,
  };

  for (const entry of event.unavailable) {
    if (entry.reason === "absent" && entry.completeness === "unverified") {
      problems.push(
        `${entry.field} claims absent on an answer whose completeness is unverified — use indeterminate`,
      );
    }
    // The converse guard, so the two words cannot drift apart in use.
    if (entry.reason === "indeterminate" && entry.completeness === "verified") {
      problems.push(
        `${entry.field} claims indeterminate on a verified answer — say what the answer was`,
      );
    }
    if (entry.reason === "indeterminate" && entry.completeness === undefined) {
      problems.push(`${entry.field} is indeterminate without stating completeness`);
    }

    problems.push(...verifiedEvidenceProblems(entry, entry.field));

    // A read that did not happen has no count. Manufacturing a zero for one
    // recreates the collapse this contract prevents, in arithmetic rather than
    // vocabulary.
    if (
      (entry.reason === "failed" || entry.reason === "not-queried") &&
      entry.observedCount !== undefined
    ) {
      problems.push(
        `${entry.field} is ${entry.reason} but carries an observedCount — no query produced one`,
      );
    }

    if (entry.observedCount !== undefined) {
      if (entry.observedCount < 0) {
        problems.push(`${entry.field} has a negative observedCount`);
      }
      const collection = observedCollections[entry.field];
      if (collection && entry.observedCount !== collection.length) {
        problems.push(
          `${entry.field} reports observedCount ${entry.observedCount} but carries ${collection.length} entries`,
        );
      }
    }
  }

  return problems;
}
