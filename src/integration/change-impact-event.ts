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

import { z } from "zod";

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

/**
 * Whether a workspace.json artifact could support claims about this subject.
 *
 * Defined here rather than beside the function that computes it, because the
 * contract owns the vocabulary its consumers compile against; the assessment is
 * an implementation of this vocabulary, not the source of it.
 *
 * Only `exact-match` permits workspace-derived claims. The rest are refusals,
 * and they are kept distinct because they have different fixes: a mismatched
 * repository means the wrong artifact was supplied, a mismatched revision means
 * a stale one, and an ambiguous path means the index cannot single out a source.
 */
export type WorkspaceIntegrity =
  | "exact-match"
  | "artifact-unavailable"
  | "repository-mismatch"
  | "revision-mismatch"
  | "path-unresolved"
  | "path-ambiguous";

/**
 * How the dataset's producing file was determined.
 *
 * `external-url` is **currently unreachable, deliberately.** It depends on
 * `Dataset.externalUrl`, which `evaluation/mcp-field-coverage.md` records as
 * dropped at the official MCP boundary — so producing it would assert a
 * capability an MCP agent does not have, which is the same shape of error as
 * joining a subject against another repository's index.
 *
 * It is kept rather than deleted because the condition that makes it honest is
 * named and in flight: HAC-156 exposes `externalUrl` through MCP upstream. When
 * that lands, this becomes reachable by removing a restriction rather than by
 * inventing a capability. Until then a test asserts the emitter cannot produce
 * it, so the unreachability is a stated and checked fact rather than an
 * accident nobody noticed.
 */
export type ResolutionMethod =
  /** Commit-pinned source URL. Gated on HAC-156 — see the note above. */
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
  /**
   * Identity and integrity disposition of the workspace artifact, when supplied.
   *
   * `repository`, `revision` and `integrity` are **required**, not optional, and
   * the distinction is the whole point. Optional fields let an event omit its
   * corpus identity and still validate — so the guard would not apply to
   * precisely the events most likely to be malformed, and a reader could not
   * tell "matched" from "never checked". That is absence read as safety, inside
   * the fix for absence read as safety.
   *
   * `integrity` is recorded even when it is a refusal — especially then. It is
   * what makes `validateEvent` able to reject a workspace claim the artifact
   * could not support.
   */
  workspaceArtifact: {
    producedBy: string | null;
    fileIndexKeys: number | null;
    repository: string | null;
    revision: string | null;
    integrity: WorkspaceIntegrity;
  } | null;
}

/**
 * The contract version consumers compile against.
 *
 * 1.1 added `datahub.lineageObservation` as a **required** field. That is a
 * breaking change, and it gets a version because leaving it at 1.0 would let
 * two incompatible shapes both claim the same identity — an artifact asserting
 * something about itself that is not true, which is the defect class this whole
 * contract exists to prevent. A consumer must be able to tell the shapes apart
 * by reading the event, not by probing for a field.
 *
 * Migration from 1.0: **re-emit.** There is no in-place upgrade, and offering
 * one would be dishonest. The added field records whether a lineage read was
 * complete; a 1.0 event does not carry that information, so any value
 * synthesised for it would be invented rather than observed. A migration that
 * defaults `completeness` to `unverified` looks harmless and is not — it would
 * manufacture an observation nobody made, on the exact axis the field exists to
 * keep honest.
 *
 * `validateEvent` therefore rejects 1.0 events by name and says to re-emit,
 * rather than reporting a confusing missing-field error.
 *
 * 1.2 made `provenance.workspaceArtifact.repository`, `.revision` and
 * `.integrity` **required**, for the same reason and with the same consequence.
 * A 1.1 event records that some artifact was read and how many keys it held, but
 * not which repository it described nor whether that repository matched the
 * subject — so an event joined against the wrong corpus is indistinguishable
 * from one joined against the right corpus, and both look verified.
 *
 * Not hypothetical: the committed nested fixture asserted a producing file was
 * absent from an index built from a different repository, and marked the claim
 * `verified: true` (HAC-225).
 *
 * No in-place upgrade from 1.1 either. The corpus a past event was joined
 * against is not recoverable from the event, and inferring it from the subject
 * would assume exactly the thing the field exists to check.
 *
 * Note on the number: this project does not claim semver for this contract, and
 * 1.0 → 1.1 already established that a breaking change takes a minor. **Both
 * bumps are breaking.** The version string distinguishes shapes; it is not a
 * compatibility promise, and `SUPERSEDED_EVENT_VERSIONS` is the signal to read.
 */
export const CHANGE_IMPACT_EVENT_VERSION = "1.2" as const;

/** Versions this contract knows about but can no longer validate. */
export const SUPERSEDED_EVENT_VERSIONS: Record<string, string> = {
  "1.0": "1.1 requires datahub.lineageObservation, which a 1.0 event does not carry — re-emit the event rather than upgrading it in place",
  "1.1": "1.2 requires provenance.workspaceArtifact.repository, .revision and .integrity, which a 1.1 event does not carry — re-emit the event rather than upgrading it in place",
};

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

// ---------------------------------------------------------------------------
// Runtime shape
//
// The interfaces above are the documentation; this is the enforcement. They are
// two artifacts describing one contract, and the assertions at the end of this
// block make drift between them a compile error rather than a silent divergence.
//
// Why this exists at all: every producer of these events is an untyped `.mjs`
// script, so the compiler never sees them. Before this, "required" meant
// "required of callers who happened to be writing TypeScript" — and none of the
// ones that matter were. An event could omit `subject` entirely and validate
// clean, or carry an undeclared key straight into the frozen artifact.
//
// Every object is `.strict()`. An unknown key is not a harmless extra: it is a
// field no consumer is documented to expect, shipped inside an artifact whose
// whole purpose is that its claims can be trusted.
// ---------------------------------------------------------------------------

const contextSourceSchema = z.enum(["datahub", "workspacejson"]);
const completenessSchema = z.enum(["verified", "unverified"]);

const verificationEvidenceSchema = z.strictObject({
  manifestDigest: z.string(),
  expectedSetDigest: z.string(),
  observedSetDigest: z.string(),
  queryParameters: z.record(z.string(), z.union([z.string(), z.number()])),
});

const unavailableSchema = z.strictObject({
  field: z.string(),
  source: contextSourceSchema,
  reason: z.enum(["absent", "not-queried", "failed", "indeterminate", "not-exposed-by-source"]),
  detail: z.string(),
  completeness: completenessSchema.optional(),
  observedCount: z.number().optional(),
  verification: verificationEvidenceSchema.optional(),
});

const codeResolutionSchema = z.strictObject({
  dbtUniqueId: z.string().nullable(),
  dbtFilePath: z.string().nullable(),
  repositoryRelativePath: z.string().nullable(),
  projectPrefix: z.string().nullable(),
  method: z.enum(["external-url", "dbt-file-path", "manifest-join", "unresolved"]),
  sourceUrl: z.string().nullable(),
});

const lineageEdgeSchema = z.strictObject({
  urn: z.string(),
  name: z.string().nullable(),
  degree: z.number(),
});

const lineageObservationSchema = z.strictObject({
  read: z.enum(["ok", "failed", "not-queried"]),
  completeness: completenessSchema,
  observedCount: z.number().optional(),
  verification: verificationEvidenceSchema.optional(),
});

const dataHubContextSchema = z.strictObject({
  name: z.string().nullable(),
  platform: z.string().nullable(),
  description: z.string().nullable(),
  upstreams: z.array(lineageEdgeSchema),
  downstreams: z.array(lineageEdgeSchema),
  lineageObservation: z.strictObject({
    upstreams: lineageObservationSchema,
    downstreams: lineageObservationSchema,
  }),
  schemaFieldCount: z.number().nullable(),
  owners: z.array(z.string()),
  domain: z.string().nullable(),
});

const codePartnerSchema = z.strictObject({
  repositoryRelativePath: z.string(),
  reason: z.string(),
  source: contextSourceSchema,
});

const evidenceRecordSchema = z.strictObject({
  claim: z.string(),
  observation: z.string(),
  source: contextSourceSchema,
  verified: z.boolean(),
});

const corpusIdentitySchema = z.strictObject({
  repository: z.string().nullable(),
  commit: z.string().nullable(),
});

const provenanceSchema = z.strictObject({
  producedAt: z.string(),
  producer: z.strictObject({ name: z.string(), version: z.string() }),
  datahub: z.strictObject({ gmsUrl: z.string(), gmsVersion: z.string().nullable() }),
  corpus: corpusIdentitySchema,
  workspaceArtifact: z.strictObject({
    producedBy: z.string().nullable(),
    fileIndexKeys: z.number().nullable(),
    repository: z.string().nullable(),
    revision: z.string().nullable(),
    integrity: z.enum([
      "exact-match", "artifact-unavailable", "repository-mismatch",
      "revision-mismatch", "path-unresolved", "path-ambiguous",
    ]),
  }).nullable(),
});

const accountingSchema = z.strictObject({
  datasetsRequested: z.number(),
  datasetsResolved: z.number(),
  datasetsUnresolved: z.number(),
  nodesDropped: z.number(),
  nodesExcluded: z.record(z.string(), z.number()),
});

/** The pure contract. Nothing beyond these keys is part of it. */
export const changeImpactEventSchema = z.strictObject({
  eventVersion: z.literal(CHANGE_IMPACT_EVENT_VERSION),
  provenance: provenanceSchema,
  subject: z.strictObject({ urn: z.string() }),
  datahub: dataHubContextSchema,
  code: codeResolutionSchema,
  partners: z.array(codePartnerSchema),
  evidence: z.strictObject({
    records: z.array(evidenceRecordSchema),
    tier: z.enum(["ASSERTED", "OBSERVED", "VERIFIED"]),
  }),
  accounting: accountingSchema,
  unavailable: z.array(unavailableSchema),
});

/**
 * What `validateEvent` actually parses.
 *
 * `writeback` is the one documented extension: `EnrichedChangeImpactEvent` adds
 * it, the golden fixtures carry it, and `validateEvent` is called on those. Its
 * shape is owned by the writeback module, so it is admitted by name and not
 * inspected here — importing that schema would make the contract depend on a
 * consumer of it. Naming it explicitly is the point: `.strict()` still rejects
 * every key that is not this one, so the extension is a decision rather than a
 * hole.
 */
const validatableEventSchema = changeImpactEventSchema.extend({
  writeback: z.unknown().optional(),
});

/**
 * Drift guards: if an interface and its schema stop describing the same fields,
 * these stop compiling. That is what makes two artifacts safe to keep.
 *
 * They compare key sets rather than full assignability, because
 * `exactOptionalPropertyTypes` is on and Zod's `.optional()` infers
 * `T | undefined` where the interface says `?: T`. Under this flag those are
 * different types, but not a different *contract* — the events are parsed from
 * JSON, which cannot produce an explicit `undefined`. Key-set equality catches
 * what actually drifts: a field added to one and not the other, or renamed.
 */
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A] ? true : never
  : never;

const _drift: [
  SameKeys<ChangeImpactEvent, z.infer<typeof changeImpactEventSchema>>,
  SameKeys<Provenance, z.infer<typeof provenanceSchema>>,
  SameKeys<Unavailable, z.infer<typeof unavailableSchema>>,
  SameKeys<CodeResolution, z.infer<typeof codeResolutionSchema>>,
  SameKeys<DataHubContext, z.infer<typeof dataHubContextSchema>>,
  SameKeys<LineageObservation, z.infer<typeof lineageObservationSchema>>,
  SameKeys<LineageEdge, z.infer<typeof lineageEdgeSchema>>,
  SameKeys<CodePartner, z.infer<typeof codePartnerSchema>>,
  SameKeys<EvidenceRecord, z.infer<typeof evidenceRecordSchema>>,
  SameKeys<ResolutionAccounting, z.infer<typeof accountingSchema>>,
  SameKeys<VerificationEvidence, z.infer<typeof verificationEvidenceSchema>>,
] = [true, true, true, true, true, true, true, true, true, true, true];
void _drift;

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
  // Explicit `| undefined` rather than bare `?:`. Under
  // `exactOptionalPropertyTypes` those differ, and this reads values that came
  // out of a schema parse, where an absent optional surfaces as `undefined`.
  holder: { completeness?: Completeness | undefined; verification?: VerificationEvidence | undefined },
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

/**
 * Check an event against the contract.
 *
 * Accepts `unknown` rather than `ChangeImpactEvent`. The parameter type was
 * always a fiction here: the callers that matter are untyped `.mjs` producers
 * and JSON read off disk, so annotating the input as already-valid asserted the
 * very thing this function exists to determine — and left it reaching into
 * fields that might not be there. Six of the eight required top-level fields
 * threw a `TypeError` when omitted, in a function whose contract is to return
 * problems so a receipt can show them.
 *
 * Two passes, in order:
 *
 * 1. **Shape and presence**, from the schema. Anything missing, mistyped, or
 *    undeclared is reported here, and the function returns before pass two.
 * 2. **Invariants**, in code. Whether the accounting reconciles, whether the
 *    tier is the mechanical function of its records, whether an absence earned
 *    the word it used. A schema cannot express these; it can only guarantee the
 *    fields they read are present.
 *
 * Returning early between them is deliberate. Invariant checks on a malformed
 * event produce noise about consequences of the shape error rather than the
 * error itself.
 */
export function validateEvent(event: unknown): string[] {
  const problems: string[] = [];

  // Version first, before shape. A superseded event has a *different* shape, so
  // reporting its missing fields would bury the one fact that explains them.
  const declaredVersion = (event as { eventVersion?: unknown } | null)?.eventVersion;
  if (declaredVersion !== CHANGE_IMPACT_EVENT_VERSION) {
    const superseded = SUPERSEDED_EVENT_VERSIONS[declaredVersion as string];
    return [
      superseded
        ? `eventVersion ${declaredVersion} is superseded by ${CHANGE_IMPACT_EVENT_VERSION}: ${superseded}`
        : `unknown eventVersion ${String(declaredVersion)}`,
    ];
  }

  const parsed = validatableEventSchema.safeParse(event);
  if (!parsed.success) {
    // One line per issue, path-prefixed, so a receipt names the field rather
    // than showing a reviewer a nested error object.
    //
    // An absent key is reported as missing rather than in the library's
    // "expected object, received undefined" phrasing. These strings are shown
    // to a human reading a receipt, and the distinction between a field that is
    // absent and a field that holds the wrong type is one they act on
    // differently.
    return parsed.error.issues.map((issue) => {
      const path = issue.path.join(".") || "(root)";
      const isAbsent =
        issue.code === "invalid_type" && issue.message.endsWith("received undefined");
      return isAbsent ? `${path}: is missing` : `${path}: ${issue.message}`;
    });
  }

  // From here the shape is guaranteed, so the invariant checks below can read
  // fields directly without guarding each access.
  const valid = parsed.data;


  // Stated on every event, in both directions, whether or not anything is
  // missing — a partial answer is the case that looks like a complete one.
  for (const [direction, edges] of [
    ["upstreams", valid.datahub.upstreams],
    ["downstreams", valid.datahub.downstreams],
  ] as const) {
    const label = `datahub.lineageObservation.${direction}`;
    const observation = valid.datahub.lineageObservation?.[direction];
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

  const { datasetsRequested, datasetsResolved, datasetsUnresolved } = valid.accounting;
  if (datasetsResolved + datasetsUnresolved !== datasetsRequested) {
    problems.push(
      `accounting does not reconcile: ${datasetsResolved} resolved + ${datasetsUnresolved} unresolved != ${datasetsRequested} requested`,
    );
  }

  if (deriveTier(valid.evidence.records) !== valid.evidence.tier) {
    problems.push("evidence.tier is not the mechanical function of evidence.records");
  }

  // A workspace.json claim is a claim about one repository at one revision.
  // When the artifact does not match the subject, the file-index lookup still
  // runs and still returns an answer — to a question nobody asked. These two
  // checks refuse the ways that answer gets dressed up as evidence.
  //
  // The disposition is computed at read time and recorded on the event, so this
  // re-derives nothing: it holds the event to what its own integrity field says.
  // Anything other than `exact-match` is a refusal, and a refusal cannot carry
  // verified repository claims or earn the word `absent`.
  // Presence is the schema's job, not this function's. An event that omits
  // `workspaceArtifact.integrity` never reaches here: pass one rejects it and
  // names the path. A hand-rolled presence loop beside the schema would be a
  // second definition of one rule, and two definitions of one rule is how these
  // fields became compile-time-only to begin with.
  const artifact = valid.provenance.workspaceArtifact;
  if (artifact && artifact.integrity !== "exact-match") {
    const verifiedClaims = valid.evidence.records.filter(
      (r) => r.source === "workspacejson" && r.verified,
    );
    if (verifiedClaims.length > 0) {
      problems.push(
        `evidence carries ${verifiedClaims.length} verified workspacejson claim(s), but workspaceArtifact.integrity is ${artifact.integrity} — an artifact that was refused verifies nothing`,
      );
    }
    // `absent` is the vocabulary's strongest word: asked, and reported nothing.
    // Non-membership in an index that was never established to describe this
    // subject cannot earn it.
    const assertedAbsent = valid.unavailable.filter(
      (u) => u.source === "workspacejson" && u.reason === "absent",
    );
    if (assertedAbsent.length > 0) {
      problems.push(
        `unavailable asserts workspacejson 'absent' on ${assertedAbsent.map((u) => u.field).join(", ")}, but workspaceArtifact.integrity is ${artifact.integrity} — absence from an unmatched artifact is not absence`,
      );
    }
  }

  // The core rule: an empty result must be accompanied by a stated reason.
  const emptyNeedsReason: Array<[unknown[], string]> = [
    [valid.datahub.upstreams, "datahub.upstreams"],
    [valid.datahub.downstreams, "datahub.downstreams"],
    [valid.partners, "partners"],
  ];
  for (const [collection, field] of emptyNeedsReason) {
    if (collection.length === 0 && !valid.unavailable.some((u) => u.field === field)) {
      problems.push(
        `${field} is empty with no entry in unavailable — a consumer cannot tell absence from failure`,
      );
    }
  }

  if (valid.code.method === "unresolved" && valid.code.repositoryRelativePath !== null) {
    problems.push("code.method is unresolved but a repositoryRelativePath is present");
  }

  // An `absent` claim asserts the source was asked and holds nothing. That is
  // only sayable on an answer known to be complete. A partially-converged index
  // returning zero edges is the case this exists for: it satisfies "asked and
  // got nothing" while being no evidence at all about the data.
  const observedCollections: Record<string, unknown[] | undefined> = {
    "datahub.upstreams": valid.datahub.upstreams,
    "datahub.downstreams": valid.datahub.downstreams,
    partners: valid.partners,
  };

  for (const entry of valid.unavailable) {
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
