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
 * `not-established` at once, and one field cannot say both without losing the
 * distinction.
 *
 * Both words name what was actually determined, rather than grading it:
 *
 *   complete-against-pinned-manifest  checked against a named, pinned expected
 *                                     set, and found equal to it
 *   not-established                   completeness was not determined
 *
 * The earlier pair was `verified | unverified`, and the rename is the point of
 * this vocabulary rather than cosmetics on it. `verified` is a grade — it says
 * an answer passed without saying what it passed against, so it reads as a
 * general warrant of correctness and invites exactly one question the value
 * cannot answer: verified how? `complete-against-pinned-manifest` carries its
 * own scope, so the claim and its bound cannot be separated in a reader's head,
 * and `VerificationEvidence` names the specific manifest.
 *
 * `not-established` replaces `unverified` for the mirror-image reason.
 * `unverified` describes a process that did not happen and reads as a soft
 * failure — as though the answer is probably fine but nobody got round to
 * confirming it. The answer may be complete, partial, or empty; what is being
 * stated is that nothing determined which. That is the honest and usually
 * correct state of a search-backed read, not a defect.
 *
 * Nothing in a general read path can upgrade `not-established` on its own.
 * Repetition is not attestation: two identical samples do not prove
 * convergence, and neither does a long wait at zero.
 */
export type Completeness = "complete-against-pinned-manifest" | "not-established";

/**
 * What a `complete-against-pinned-manifest` claim rests on.
 *
 * Required rather than optional, because a second axis with no evidence behind
 * it is merely a new place to assert completeness. The point of the axis is to
 * make completeness checkable; a bare enum would make it assertable.
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
  /** Required whenever `completeness` is `complete-against-pinned-manifest`. */
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
export const WORKSPACE_INTEGRITY_VALUES = [
  "exact-match",
  "artifact-unavailable",
  "repository-mismatch",
  "revision-mismatch",
  "path-unresolved",
  "path-ambiguous",
] as const;

export type WorkspaceIntegrity = (typeof WORKSPACE_INTEGRITY_VALUES)[number];

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
  /** Required whenever `completeness` is `complete-against-pinned-manifest`. */
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
 * record. VERIFIED: at least one record whose check this harness executed.
 *
 * The token is a machine value, not a caption. `VERIFIED` says a check ran; it
 * does not say the claim is true, and the two are close enough in English that
 * the bare word will be read as the second. It must therefore never reach a
 * surface on its own — `describeTier` is the only sanctioned rendering, and it
 * carries the record count that produced the tier. See the note there.
 */
export type EvidenceTier = "ASSERTED" | "OBSERVED" | "VERIFIED";

export interface EvidenceRecord {
  claim: string;
  /** What was actually run or read to support the claim. */
  observation: string;
  source: ContextSource;
  /**
   * True only when this harness executed the check itself.
   *
   * Named for the act, not the verdict. As `verified` it was the most
   * over-readable field in the contract: it says a check *ran*, and every
   * reader — including this project's own emitter — took it to mean the claim
   * was *confirmed*. The nested fixture asserted a producing file absent from
   * an index built from a different repository and marked it `verified: true`
   * (HAC-225); the field was accurate about execution and the word invited the
   * stronger reading.
   *
   * `checkExecuted` cannot be misread that way, because it does not describe
   * the claim at all. Whether the claim holds is what `observation` records and
   * what a reviewer judges.
   */
  checkExecuted: boolean;
}

/**
 * One dataset that did not resolve, and why.
 *
 * A count says how many answers are missing. It cannot say which, and "which"
 * is the difference between a reader who can act and one who can only worry.
 * The reason is required rather than optional because HAC-217's gate asks for
 * scope establishment, not just identity: a name with no reason says a dataset
 * failed without saying whether the manifest lacked it, the path was ambiguous,
 * or the artifact never covered it — three different fixes.
 *
 * `reason` is free text on purpose. A closed vocabulary was considered and
 * deferred: the failure modes are not yet enumerable from evidence, and
 * inventing an enum to look rigorous would be the same error as inventing the
 * names — a shape asserting more structure than anyone has observed.
 */
export interface UnresolvedDatasetRecord {
  urn: string;
  reason: string;
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
  /**
   * The unresolved datasets themselves, when the producer can name them.
   *
   * Optional, and that is the whole compatibility story: every artifact emitted
   * before this field existed stays valid, and the projection keeps its honest
   * "the count is recorded, the names are not carried" fallback for them. A
   * producer that can name them must name all of them — see the invariant.
   */
  unresolvedRecords?: UnresolvedDatasetRecord[];
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
 * 1.3 froze the vocabulary (HAC-146). `EvidenceRecord.verified` became
 * `checkExecuted`, the writeback receipt's `verified` became `bothStatesRead`,
 * and `Completeness` became `complete-against-pinned-manifest | not-established`.
 *
 * This one is a pure rename, and it is the only version here that *could* have
 * shipped a mechanical in-place migration — the values map one-to-one and no
 * information is missing. It deliberately does not, for two reasons.
 *
 * First, the renames exist because the old words were being *misread*, and a
 * translation layer would keep both readings alive in the codebase at once:
 * every consumer would still see `verified` somewhere, which is the condition
 * the rename was meant to end. A dual vocabulary is not a gentler migration, it
 * is the defect with a compatibility shim around it.
 *
 * Second, a 1.2 event's `verified: true` is only trustworthy to the extent the
 * producer meant "a check ran" rather than "the claim holds" — and the reason
 * for the rename is that this project's own emitter did not reliably mean the
 * first. Mapping it silently onto `checkExecuted` would launder that ambiguity
 * into the new vocabulary and call it migrated.
 *
 * Note on the number: this project does not claim semver for this contract, and
 * 1.0 → 1.1 already established that a breaking change takes a minor. **All
 * three bumps are breaking.** The version string distinguishes shapes; it is not
 * a compatibility promise, and `SUPERSEDED_EVENT_VERSIONS` is the signal to read.
 */
export const CHANGE_IMPACT_EVENT_VERSION = "1.3" as const;

/** Versions this contract knows about but can no longer validate. */
export const SUPERSEDED_EVENT_VERSIONS: Record<string, string> = {
  "1.0": "1.1 requires datahub.lineageObservation, which a 1.0 event does not carry — re-emit the event rather than upgrading it in place",
  "1.1": "1.2 requires provenance.workspaceArtifact.repository, .revision and .integrity, which a 1.1 event does not carry — re-emit the event rather than upgrading it in place",
  "1.2": "1.3 renames evidence.records[].verified to checkExecuted, writeback.verified to bothStatesRead, and completeness to complete-against-pinned-manifest | not-established — re-emit the event; the rename is not applied in place because a 1.2 `verified` may have meant either 'a check ran' or 'the claim holds', and only the producer knows which",
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
const completenessSchema = z.enum(["complete-against-pinned-manifest", "not-established"]);

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
  checkExecuted: z.boolean(),
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
    // One list, used by the type, the schema and the producer's reason
    // vocabulary. Three copies would drift, and the drift would be silent:
    // a new disposition would validate fine while having no reason to emit.
    integrity: z.enum(WORKSPACE_INTEGRITY_VALUES),
  }).nullable(),
});

const unresolvedDatasetRecordSchema = z.strictObject({
  urn: z.string().min(1),
  reason: z.string().min(1),
});

const accountingSchema = z.strictObject({
  datasetsRequested: z.number(),
  datasetsResolved: z.number(),
  datasetsUnresolved: z.number(),
  nodesDropped: z.number(),
  nodesExcluded: z.record(z.string(), z.number()),
  unresolvedRecords: z.array(unresolvedDatasetRecordSchema).optional(),
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
 *
 * Exported, because it is the shape events are actually *emitted* in and
 * therefore the shape every consumer reads. `changeImpactEventSchema` is the
 * pure contract and rejects `writeback` outright — a consumer that parsed the
 * golden fixtures against it would refuse every enriched event this repository
 * produces, which is what the cockpit did before HAC-219 measured it.
 */
export const emittedEventSchema = changeImpactEventSchema.extend({
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
  return records.some((r) => r.checkExecuted) ? "VERIFIED" : "OBSERVED";
}

/**
 * The tier as a phrase a reader cannot over-read, for any surface a human sees.
 *
 * `VERIFIED` alone is the contract's most dangerous string. It is a mechanical
 * fact about *records* — at least one check was executed by this harness — and
 * in English it reads as a warrant about *claims*. A judge who sees "VERIFIED
 * evidence" on a screen has been told something this project cannot support, by
 * a token that is individually accurate.
 *
 * That is the same defect as `absent` standing in for a converging index, and
 * `succeeded` standing in for an unobserved mutation: a strong word doing
 * unearned work because the thing that would bound it lives somewhere else. The
 * fix is the same one applied there — keep the claim and its bound in a single
 * value, so no caller has to remember to pair them.
 *
 * So the tier is never formatted for display anywhere else. Rendering
 * `event.evidence.tier` directly is the violation, and a test asserts no
 * judge-facing string contains a bare tier token.
 */
export function describeTier(records: readonly EvidenceRecord[]): string {
  const tier = deriveTier(records);
  if (tier === "ASSERTED") {
    return "ASSERTED — no supporting record was captured";
  }
  const executed = records.filter((r) => r.checkExecuted).length;
  return tier === "VERIFIED"
    ? `VERIFIED — ${executed} of ${records.length} record(s) carry a check this harness executed`
    : `OBSERVED — ${records.length} record(s), none of them a check this harness executed`;
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
      // Workspace-sourced entries are dropped, not carried.
      //
      // Appending to the full list left the reduced view holding two mutually
      // exclusive claims about the same field: `absent` — asked and reported
      // nothing — beside `not-queried`, never asked. Both marked
      // `source: "workspacejson"`, in the one view whose premise is that no
      // workspace evidence was consulted.
      //
      // A DataHub-only agent could not have made the first claim, so keeping it
      // misrepresents the comparison in the direction that flatters this
      // project: it shows the reduced mode reporting a finding it had no means
      // to reach. The removal is the honest reduction; `not-queried` is the
      // single accurate statement about what that mode knows.
      ...event.unavailable.filter((u) => u.source !== "workspacejson"),
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
 * Which lineage direction an `unavailable` entry is talking about.
 *
 * `unavailable` and `lineageObservation` are two representations of the same
 * fact, and until these checks existed nothing held them to each other. The
 * observation is the canonical record — it is mandatory on every event, in both
 * directions, precisely so that completeness cannot go unstated. An `unavailable`
 * entry is the human explanation beside it, never a second source of truth.
 */
const LINEAGE_FIELDS = {
  "datahub.upstreams": "upstreams",
  "datahub.downstreams": "downstreams",
} as const;

/** The query direction a manifest for that field must have been taken under. */
const QUERY_DIRECTION = {
  upstreams: "UPSTREAM",
  downstreams: "DOWNSTREAM",
} as const;

/** Two evidence blocks describe the same attestation, or they do not. */
function sameVerification(
  a: VerificationEvidence | undefined,
  b: VerificationEvidence | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.manifestDigest === b.manifestDigest &&
    a.expectedSetDigest === b.expectedSetDigest &&
    a.observedSetDigest === b.observedSetDigest &&
    JSON.stringify(Object.entries(a.queryParameters).sort()) ===
      JSON.stringify(Object.entries(b.queryParameters).sort())
  );
}

/**
 * Hold an `unavailable` lineage entry to the canonical observation beside it.
 *
 * Without this, one event could say both things about one answer. The case that
 * exposed it was a test fixture this contract's own author wrote: the upstream
 * observation said `not-established` while the `unavailable` entry for the same
 * field said `complete-against-pinned-manifest`, with expected and observed
 * digests that differed — and `validateEvent` returned no problems.
 *
 * That is the contract's central failure mode reproduced across two fields
 * instead of inside one: a claim standing next to evidence that does not support
 * it, where the mismatch is only visible if someone thinks to compare them. The
 * fix is the same one applied to `succeeded` and to `absent` — the comparison
 * happens here, once, rather than in the head of every reader.
 */
function lineageAgreementProblems(
  entry: {
    field: string;
    reason: UnavailableReason;
    completeness?: Completeness | undefined;
    observedCount?: number | undefined;
    verification?: VerificationEvidence | undefined;
  },
  // Explicit `| undefined` on the members, not `LineageObservation`. These
  // values come out of a schema parse, where an absent optional surfaces as an
  // explicit `undefined` — which `exactOptionalPropertyTypes` treats as a
  // different type from the interface's `?:`. Same contract, different spelling.
  observations: Record<
    "upstreams" | "downstreams",
    | {
        read: LineageObservation["read"];
        completeness: Completeness;
        observedCount?: number | undefined;
        verification?: VerificationEvidence | undefined;
      }
    | undefined
  >,
  edgeCounts: Record<"upstreams" | "downstreams", number>,
): string[] {
  const direction = LINEAGE_FIELDS[entry.field as keyof typeof LINEAGE_FIELDS];
  if (!direction) return [];

  const observation = observations[direction];
  // Absence of the observation is reported by the loop that owns it; adding a
  // second complaint here would name one fault twice.
  if (!observation) return [];

  const problems: string[] = [];
  const canonical = `datahub.lineageObservation.${direction}`;

  if (entry.completeness !== undefined && entry.completeness !== observation.completeness) {
    problems.push(
      `${entry.field} states completeness ${entry.completeness} but ${canonical} states ${observation.completeness} — one answer cannot be both`,
    );
  }

  if (entry.observedCount !== undefined && entry.observedCount !== observation.observedCount) {
    problems.push(
      `${entry.field} reports observedCount ${entry.observedCount} but ${canonical} reports ${observation.observedCount ?? "none"}`,
    );
  }

  if (entry.verification !== undefined || observation.verification !== undefined) {
    if (!sameVerification(entry.verification, observation.verification)) {
      problems.push(
        `${entry.field} carries verification evidence that differs from ${canonical} — the same read cannot have two attestations`,
      );
    }
  }

  // A manifest taken in the other direction is not evidence about this one.
  // Upstream and downstream closures are different sets; comparing an answer
  // against the wrong one would pass or fail for reasons unrelated to the field
  // being described.
  for (const [holder, label] of [
    [entry.verification, entry.field],
    [observation.verification, canonical],
  ] as const) {
    const stated = holder?.queryParameters?.["direction"];
    if (stated !== undefined && stated !== QUERY_DIRECTION[direction]) {
      problems.push(
        `${label} is evidenced by a manifest queried ${String(stated)}, but the field describes ${QUERY_DIRECTION[direction]} lineage`,
      );
    }
  }

  // `absent` on lineage is the strongest thing this contract can say about a
  // catalog: it was asked, it answered, the answer was established complete, and
  // it was empty. Every one of those has to be true at once, and each is
  // recorded in a different place — so they are checked together here rather
  // than left to line up by coincidence.
  if (entry.reason === "absent") {
    if (observation.read !== "ok") {
      problems.push(
        `${entry.field} claims absent but ${canonical} read is ${observation.read} — a read that did not happen found nothing to report`,
      );
    }
    if (edgeCounts[direction] > 0) {
      problems.push(
        `${entry.field} claims absent but ${edgeCounts[direction]} edge(s) are carried`,
      );
    }
    if (observation.observedCount !== 0) {
      problems.push(
        `${entry.field} claims absent but ${canonical} observed ${observation.observedCount ?? "no"} edge(s)`,
      );
    }
    if (observation.completeness !== "complete-against-pinned-manifest") {
      problems.push(
        `${entry.field} claims absent while ${canonical} completeness is ${observation.completeness} — absence is only sayable about an answer established complete against a pinned manifest`,
      );
    }
    // No attestation-match check here, deliberately.
    //
    // One was written and removed: mutation testing could not kill it. The
    // general agreement check above fires whenever *either* side carries
    // evidence, so an absent-specific version can only be reached when both are
    // `undefined` — where they are equal by definition. It was unreachable.
    //
    // Removed rather than left in place with a note, because a guard no test can
    // kill is worse than no guard: it reads as coverage, and the next person to
    // touch this file would trust it.
  }

  return problems;
}

/**
 * A second axis with nothing behind it is just a new place to assert the word.
 * `complete-against-pinned-manifest` names a manifest, so it has to produce one
 * — wherever it is claimed. This is the only path to that value.
 */
function completenessEvidenceProblems(
  // Explicit `| undefined` rather than bare `?:`. Under
  // `exactOptionalPropertyTypes` those differ, and this reads values that came
  // out of a schema parse, where an absent optional surfaces as `undefined`.
  holder: { completeness?: Completeness | undefined; verification?: VerificationEvidence | undefined },
  label: string,
): string[] {
  if (holder.completeness !== "complete-against-pinned-manifest") return [];
  const v = holder.verification;
  const missing = !v
    ? ["verification"]
    : (["manifestDigest", "expectedSetDigest", "observedSetDigest"] as const).filter((k) => !v[k]);
  if (!v || missing.length > 0 || Object.keys(v.queryParameters ?? {}).length === 0) {
    return [
      `${label} claims complete-against-pinned-manifest without naming the manifest (${missing.join(", ") || "queryParameters"})`,
    ];
  }

  // The digests must agree, or the evidence refutes the claim it is attached to.
  //
  // `complete-against-pinned-manifest` means one thing: the observed set was
  // compared against the pinned expected set and found equal. Two different
  // digests are the record of a comparison that came out *unequal* — so an event
  // carrying them is asserting completeness on evidence that disproves it, with
  // the disproof sitting in the adjacent field.
  //
  // This is the cheapest possible check and it was missing, which meant the
  // evidence block could be populated with any two strings and satisfy the gate.
  // Requiring the block was only ever half the requirement; requiring it to
  // *agree* is the other half.
  //
  // Equality is the minimum internal invariant, not the whole story: it cannot
  // tell whether the digests were honestly derived. That remains the producer's
  // obligation, and for lineage it is HAC-231's.
  if (v.expectedSetDigest !== v.observedSetDigest) {
    return [
      `${label} claims complete-against-pinned-manifest but its expected and observed set digests differ (${v.expectedSetDigest} vs ${v.observedSetDigest}) — unequal sets are the record of an incomplete answer`,
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

  const parsed = emittedEventSchema.safeParse(event);
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
    // Not optional-chained, and no missing-observation branch.
    //
    // `lineageObservation` is a required `strictObject` with both directions
    // required, inside a required `dataHubContext`. Pass one rejects an event
    // that omits any of them and returns before reaching here, so by this point
    // the value is guaranteed.
    //
    // There was a `if (!observation) { ... continue; }` here, and mutation
    // testing could not kill it: no input reaches it. It read as a safety net
    // and was an unreachable branch, which is worse than nothing — it implies
    // the absence is possible and handled, so the next reader assumes a
    // guarantee is being defended rather than relied upon. The schema is the
    // guarantee; this reads it.
    const observation = valid.datahub.lineageObservation[direction];

    problems.push(...completenessEvidenceProblems(observation, label));

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
      if (observation.completeness === "complete-against-pinned-manifest") {
        problems.push(`${label} claims complete-against-pinned-manifest on a read that did not happen`);
      }
    }
  }

  const { datasetsRequested, datasetsResolved, datasetsUnresolved, unresolvedRecords } = valid.accounting;
  if (datasetsResolved + datasetsUnresolved !== datasetsRequested) {
    problems.push(
      `accounting does not reconcile: ${datasetsResolved} resolved + ${datasetsUnresolved} unresolved != ${datasetsRequested} requested`,
    );
  }

  // HAC-146's Invariants require rejecting "unresolved counts without the
  // matching named unresolved items". Specified 2026-07-13, unbuilt until now.
  //
  // The check is conditional on presence, not on the count, because an artifact
  // predating the field is not lying — it simply carries less. What must never
  // pass is a *partial* naming: `datasetsUnresolved: 2` shipping one record
  // reads as a complete list and is not one, which is a new way to be quietly
  // incomplete inside the field added to prevent exactly that.
  if (unresolvedRecords !== undefined) {
    if (unresolvedRecords.length !== datasetsUnresolved) {
      problems.push(
        `accounting names ${unresolvedRecords.length} unresolved dataset(s) but counts ${datasetsUnresolved}; a partial list reads as a complete one`,
      );
    }
    const urns = unresolvedRecords.map((record) => record.urn);
    const duplicates = [...new Set(urns.filter((urn, index) => urns.indexOf(urn) !== index))];
    if (duplicates.length > 0) {
      problems.push(
        `accounting names the same unresolved dataset more than once: ${duplicates.join(", ")}`,
      );
    }
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
    const executedClaims = valid.evidence.records.filter(
      (r) => r.source === "workspacejson" && r.checkExecuted,
    );
    if (executedClaims.length > 0) {
      problems.push(
        `evidence carries ${executedClaims.length} workspacejson record(s) marked checkExecuted, but workspaceArtifact.integrity is ${artifact.integrity} — a check run against a refused artifact establishes nothing about this subject`,
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
    // `absent` is the vocabulary's strongest word, so it is gated on the
    // strongest completeness value — which in turn cannot be claimed without
    // `VerificationEvidence`. That chain is the whole requirement: absence is
    // only sayable about an answer established complete against a pinned
    // manifest.
    //
    // Written as `!== complete-against-pinned-manifest` rather than
    // `=== not-established`, because the two differ on the case that was
    // actually escaping: `completeness` omitted entirely. Only the explicit
    // pairing was rejected, so a producer that stated no completeness at all
    // claimed absence with nothing behind it and validated clean — the missing
    // field read as permission, inside the check written to stop absence being
    // read as safety.
    if (entry.reason === "absent" && entry.completeness !== "complete-against-pinned-manifest") {
      problems.push(
        entry.completeness === undefined
          ? `${entry.field} claims absent without stating completeness — absence is only sayable about an answer established complete against a pinned manifest`
          : `${entry.field} claims absent on an answer whose completeness is ${entry.completeness} — use indeterminate`,
      );
    }
    // The converse guard, so the two words cannot drift apart in use.
    if (entry.reason === "indeterminate" && entry.completeness === "complete-against-pinned-manifest") {
      problems.push(
        `${entry.field} claims indeterminate on an answer established complete against a pinned manifest — say what the answer was`,
      );
    }
    if (entry.reason === "indeterminate" && entry.completeness === undefined) {
      problems.push(`${entry.field} is indeterminate without stating completeness`);
    }

    problems.push(...completenessEvidenceProblems(entry, entry.field));

    // Held to the canonical observation, for the lineage fields that have one.
    problems.push(
      ...lineageAgreementProblems(
        entry,
        valid.datahub.lineageObservation ?? { upstreams: undefined, downstreams: undefined },
        {
          upstreams: valid.datahub.upstreams.length,
          downstreams: valid.datahub.downstreams.length,
        },
      ),
    );

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
