import { z } from "zod";

export const sourceSchema = z.enum(["DataHub", "workspace.json", "Joined", "unavailable"]);
export const readSchema = z.enum(["ok", "failed", "not-queried"]);
export const completenessSchema = z.enum(["complete-against-pinned-manifest", "not-established"]);
/**
 * How far the workspace artifact got at resolving the subject's producing file.
 *
 * These are the five values HAC-146 ratified, and the axis previously carried
 * four different ones (`resolved | partial | mismatch | unavailable`). The gap
 * was not cosmetic: `path-unresolved` and `path-ambiguous` both collapsed into
 * `partial`, so "the index holds no candidate" and "the index holds several and
 * cannot choose" reached a reviewer as the same word — while the comment above
 * the mapping table claimed refusals were kept distinct.
 *
 * They are different findings with different fixes. An unresolved path means the
 * artifact does not describe the file; an ambiguous one means it describes it
 * more than once and the join cannot single it out. Telling a reviewer only that
 * "something was partial" costs them the diagnosis.
 */
export const resolutionDispositionSchema = z.enum([
  "exact", "ambiguous", "unavailable", "mismatch", "indeterminate",
]);
export const mutationAcceptanceSchema = z.enum(["not-attempted", "accepted", "rejected"]);
export const intendedStateObservationSchema = z.enum(["not-attempted", "observed", "not-observed"]);
export const terminalWritebackDispositionSchema = z.enum(["not-applicable", "success", "accepted-not-observed", "failed", "noop", "indeterminate", "contradictory"]);
/**
 * Two modes, not three.
 *
 * `fixture` and `live` were the same behaviour under two names: both read the
 * same committed bytes at build time and produced the same projection, so the
 * label was the only difference and `live` asserted a connection that never
 * happened. `committed` says how the build acquired its evidence, which is the
 * only thing a build can honestly claim. How the evidence was produced lives in
 * the event's own provenance block.
 */
export const sourceModeSchema = z.enum(["placeholder", "committed"]);
export const cockpitRouteSchema = z.enum(["impact", "change-plan", "receipts"]);
export const claimSourceSchema = z.enum(["DataHub", "workspace.json", "Joined"]);
export const sourceClaimSchema = z.object({ text: z.string().min(1), source: claimSourceSchema });

/**
 * The kind of identifier a value carries, for progressive disclosure.
 *
 * Each type maps to a fixed human-readable label in the UI. The type is carried
 * structurally so the disclosure can say "Git commit" or "Event digest" rather
 * than a generic "identifier" — collapsing types would lose the distinction
 * between a revision pin and a content digest, which are different evidence.
 *
 * `evidence-path` is a dotted/bracket path into the event (e.g.
 * `evidence.records[0]`), not RFC 6901 JSON Pointer. The type name reflects what
 * it is.
 */
export const identifierTypeSchema = z.enum([
  "git-commit-sha",
  "event-digest",
  "set-digest",
  "manifest-digest",
  "dataset-urn",
  "evidence-path",
  "patch-digest",
]);

/**
 * Metadata for progressive disclosure of an identifier.
 *
 * `semanticLabel` is what a reader sees first — a meaning-first label, not the
 * raw identifier. The canonical value stays in `EvidenceValue.value` and is
 * revealed on demand. No `fullValue` duplication: it would disagree with `value`.
 *
 * `openUrl` is only present when a real, constructable URL exists. `copyLabel`
 * customises the copy button text (e.g. "Copy SHA" vs "Copy URN").
 */
export const identifierMetaSchema = z.object({
  type: identifierTypeSchema,
  semanticLabel: z.string().min(1),
  copyLabel: z.string().optional(),
  openUrl: z.string().url().optional(),
});

/**
 * A commit-pinned source link and its origin. See `resolveViewSource`.
 *
 * `declared` came from the catalog. `constructed` was built from provenance the
 * event already records, and carries those inputs so the construction is
 * checkable rather than trusted. `unavailable` names why neither was possible.
 */
export const viewSourceSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("declared"), url: z.string().url() }),
  z.object({
    state: z.literal("constructed"),
    url: z.string().url(),
    from: z.object({
      repository: z.string().min(1),
      revision: z.string().min(1),
      path: z.string().min(1),
    }),
  }),
  z.object({ state: z.literal("unavailable"), reason: z.string().min(1) }),
]);
/**
 * One lineage edge, with direction and degree carried structurally.
 *
 * These used to be flattened into `label` as `"upstream: name"` plus a prose
 * `reason` ending in `"at degree 2"`, which meant the only way to lay the graph
 * out by direction was to parse the strings back apart. A renderer that has to
 * re-derive what the projector already knew will eventually disagree with it.
 *
 * `direction: "none"` and a null `degree` are the zero-edge row, which is a
 * stated absence rather than a node and has no position in a topology.
 */
export const impactEdgeSchema = z.object({
  node: z.string().min(1),
  /**
   * The DataHub platform the node belongs to, read from its URN.
   *
   * Without it the upstream column reads as untidy rather than structured: the
   * fixture holds four dbt models and the four duckdb datasets they are built
   * from, so half the names are bare and half are fully qualified, and the only
   * inference available to a cold reader is that the list was not cleaned up.
   * The distinction is load-bearing and was invisible.
   *
   * Null when the URN does not carry one, rather than guessed.
   */
  platform: z.string().min(1).nullable(),
  direction: z.enum(["upstream", "downstream", "none"]),
  degree: z.number().int().positive().nullable(),
  state: z.enum(["resolved", "unresolved", "excluded"]),
  reason: z.string().min(1),
  source: sourceSchema,
});
/**
 * One semantic plan change, and the way back to what produced it.
 *
 * `evidenceRefs` is carried through from the comparison artifact rather than
 * flattened into the source tag, because `PlanComparisonArtifact` refuses to
 * emit a delta that cites nothing — a plan change asserted with nothing behind
 * it is the claim that contract exists to prevent. A view that dropped the refs
 * would be laxer than its own source, and the one screen whose job is to show a
 * real plan change would be unable to say which evidence backs it.
 */
export const planDeltaSchema = z.object({
  kind: z.enum(["added", "removed", "reordered", "constrained", "uncertainty-changed"]),
  label: z.string().min(1),
  reason: z.string().min(1),
  source: claimSourceSchema,
  evidenceRefs: z.array(z.string().min(1)).min(1),
});

/**
 * Whether a DataHub-only/joined comparison was observed, and if not, why not.
 *
 * `planDeltas: PlanDelta[]` could not express this. An empty array had to serve
 * two opposite findings: *the comparison ran and the joined context changed
 * nothing*, and *no comparison exists*. The first is a result — evidence that
 * joining the repository made no difference to the plan. The second means nobody
 * looked. Rendering both as an empty list told a judge the same thing about a
 * measurement and about its absence.
 *
 * So the state is the discriminator, matching `evidenceValueSchema` above:
 *
 * - `observed` — a comparison was run. `deltas` may be empty, and an empty
 *   `deltas` here now means exactly one thing.
 * - `unavailable` — no comparison was supplied, and the reason says why.
 *
 * The comparison's own identity travels with it. A delta list is only meaningful
 * relative to the event it was derived from and the run that produced it, so
 * `eventDigest`, `taskId` and `model` are not decoration — they are what lets a
 * reader check that both plans answered the same question against the same
 * evidence.
 *
 * Both plans travel with it too. The deltas say what changed; `datahubOnlySteps`
 * and `joinedSteps` are the two things that differ, and a frame arguing that
 * joining repository evidence changed the plan has to show them side by side or
 * it is asserting the difference rather than exhibiting it. They are steps as
 * the run produced them, so an empty joined plan is a real (and visible) result
 * rather than a rendering gap.
 */
export const planComparisonSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("observed"),
    deltas: z.array(planDeltaSchema),
    taskId: z.string().min(1),
    model: z.string().min(1),
    eventDigest: z.string().min(1),
    eventDigestIdentifier: identifierMetaSchema.optional(),
    datahubOnlySteps: z.array(z.string().min(1)),
    joinedSteps: z.array(z.string().min(1)),
  }),
  z.object({ state: z.literal("unavailable"), reason: z.string().min(1) }),
]);
export const cockpitStateNameSchema = z.enum([
  "loading", "unavailable", "partial", "ambiguous", "indeterminate", "contradictory", "error", "accepted-not-observed", "success",
]);
/**
 * One receipt field, and the standing of the value in it.
 *
 * Every receipt slot was `z.string().min(1)`, which gave an angle-bracketed
 * design placeholder and a real revision the same type. Three consequences
 * followed, and all three are the defect class this project exists to refuse: a
 * placeholder could not be distinguished from an observation by anything but the
 * banner above it, an absence had to be spelled as prose inside a value slot,
 * and a field the event genuinely does not carry had no representation except a
 * plausible-looking string.
 *
 * So the state is the discriminator, not the text:
 *
 * - `observed` — read from a named system. Carries its source tag.
 * - `declared` — a real value that was stated rather than measured. It has
 *   content, so it is not an absence; nothing executed it, so it is not an
 *   observation.
 * - `unavailable` — not carried, and the reason says *which* absence it is.
 * - `placeholder` — invented for layout. Rejected outside placeholder mode by
 *   the model refinement below, so this is a parse-time refusal rather than a
 *   render-time convention.
 *
 * `declared` exists because HAC-284 found the gap it fills being papered over.
 * A readiness manifest's query parameters are a real, useful value that no read
 * ever ran, and with only `observed` and `unavailable` available they were
 * rendered as an observation attributed to DataHub. Neither existing state was
 * honest: `unavailable` would deny a value that is right there, and `observed`
 * claimed a measurement nobody took. A value can be present and unexecuted at
 * once, and the type now says so.
 */
export const evidenceValueSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("observed"), value: z.string().min(1), source: claimSourceSchema, identifier: identifierMetaSchema.optional() }),
  z.object({ state: z.literal("declared"), value: z.string().min(1), note: z.string().min(1) }),
  z.object({ state: z.literal("unavailable"), reason: z.string().min(1) }),
  z.object({ state: z.literal("placeholder"), value: z.string().min(1) }),
]);
export type EvidenceValue = z.infer<typeof evidenceValueSchema>;
export type IdentifierType = z.infer<typeof identifierTypeSchema>;
export type IdentifierMeta = z.infer<typeof identifierMetaSchema>;

const count = z.number().int().nonnegative();

/**
 * The contract's `ResolutionAccounting`, projected under the contract's own
 * names.
 *
 * The cockpit previously invented `total / kept / dropped / excluded /
 * unresolved` and required `total === kept + dropped + excluded + unresolved`.
 * That equation cannot hold on real data, because it sums two different
 * denominators: `datasetsRequested` counts **datasets** asked of the catalog,
 * while `nodesDropped` and `nodesExcluded` count **dbt nodes** in the manifest.
 * A projection would have had to fabricate a `total` to satisfy it — inventing
 * a number on the one surface whose job is showing that no number was invented.
 *
 * One vocabulary, and the only arithmetic asserted is the arithmetic the
 * contract itself enforces in `validateEvent`.
 */
export const resolutionAccountingSchema = z.object({
  datasetsRequested: count,
  datasetsResolved: count,
  datasetsUnresolved: count,
  nodesDropped: count,
  nodesExcluded: z.record(z.string(), count),
});

/**
 * Named unresolved datasets, or a stated reason there are no names.
 *
 * "Every unresolved count has a matching named list" is the rule. Synthesising
 * names to satisfy it would satisfy it with fiction; leaving the list empty
 * beside a non-zero count reads as a contradiction. Stating the absence is the
 * third option, and the only honest one — which is what this rendered until
 * 2026-07-29, because contract 1.3's accounting was five counts with nowhere to
 * put a name.
 *
 * HAC-267 added `accounting.unresolvedRecords`, so the `observed` branch is now
 * reachable for producers that emit it. `unavailable` is retained and still
 * correct for every artifact predating the field.
 *
 * Each record carries a reason, not just a URN. HAC-217's gate asks for scope
 * establishment: a name alone says a dataset failed without saying whether the
 * manifest lacked it, the path was ambiguous, or the artifact never covered it.
 */
export const unresolvedDatasetsSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("observed"),
    records: z.array(z.object({ urn: z.string().min(1), reason: z.string().min(1) })),
  }),
  z.object({ state: z.literal("unavailable"), reason: z.string().min(1) }),
]);

/** An absence the event stated. Always named — that is what `unavailable` is for. */
/**
 * One field the event states it could not supply, and which system could not.
 *
 * `source` is carried because a gap without it cannot say *whose* gap it is, and
 * that distinction is the product's whole argument: "the catalog does not expose
 * this" and "the artifact could not resolve it" are different findings with
 * different fixes. The contract records it on `unavailable[].source`; dropping it
 * in projection made every gap read as an anonymous absence.
 */
export const statedGapSchema = z.object({
  field: z.string().min(1),
  /*
   * Exactly the contract's `ContextSource`, which is two values.
   *
   * This carried a third, `joined`, which no producer can emit: the contract's
   * `contextSourceSchema` is `z.enum(["datahub", "workspacejson"])` inside a
   * `z.strictObject`, so an event with any other value is rejected before the
   * cockpit sees it. The extra member made both renderers carry a branch that
   * could never execute, which is a value nothing writes rendering as a real
   * case. Narrowed to match, so widening the contract is a compile error here
   * rather than a silently unreachable branch.
   */
  source: z.enum(["datahub", "workspacejson"]),
  reason: z.string().min(1),
  detail: z.string().min(1),
});

/** The sanctioned rendering of a gap's source. One table, two consumers. */
export const GAP_SOURCE_LABEL: Record<z.infer<typeof statedGapSchema>["source"], string> = {
  datahub: "DataHub",
  workspacejson: "workspace.json",
};

export const receiptSchema = z.object({
  accounting: resolutionAccountingSchema,
  unresolvedDatasets: unresolvedDatasetsSchema,
  statedGaps: z.array(statedGapSchema),
  provenance: z.object({
    subjectRepository: evidenceValueSchema,
    subjectRevision: evidenceValueSchema,
    artifactRepository: evidenceValueSchema,
    artifactRevision: evidenceValueSchema,
    producerVersion: evidenceValueSchema,
    algorithmVersion: evidenceValueSchema,
    inputDigest: evidenceValueSchema,
    artifactDigest: evidenceValueSchema,
    dataHubReadParameters: evidenceValueSchema,
    /** The manifest's derivation parameters. Never an observation — see `declared`. */
    manifestDerivationParameters: evidenceValueSchema,
    producerPath: evidenceValueSchema,
    immutableSourceUrl: evidenceValueSchema,
    limitations: evidenceValueSchema,
  }),
  writeback: z.object({
    intent: evidenceValueSchema,
    beforeState: evidenceValueSchema,
    mutationResponse: mutationAcceptanceSchema,
    afterStateRead: readSchema,
    bothStatesRead: z.boolean(),
    afterStateFreshness: z.enum(["fresh", "stale", "not-read"]),
    intendedStateObservation: intendedStateObservationSchema,
    terminalDisposition: terminalWritebackDispositionSchema,
    /**
     * Derived in `writeback-axes` from the raw receipt, because the asserted
     * fields are only distinguishable there. Carried on the model rather than
     * recomputed in the refinement so the check and the value cannot disagree.
     */
    beforeMatchedIntent: z.boolean(),
  }),
  evaluation: z.object({
    locBaseline: evidenceValueSchema,
    limitations: evidenceValueSchema,
    rawEvidence: evidenceValueSchema,
  }),
}).superRefine((receipt, context) => {
  const a = receipt.accounting;
  if (a.datasetsResolved + a.datasetsUnresolved !== a.datasetsRequested) {
    context.addIssue({ code: "custom", path: ["accounting"], message: "Dataset accounting must reconcile: resolved + unresolved = requested." });
  }
  if (receipt.unresolvedDatasets.state === "observed" && receipt.unresolvedDatasets.records.length !== a.datasetsUnresolved) {
    context.addIssue({ code: "custom", path: ["unresolvedDatasets"], message: "Every unresolved count needs a matching named list." });
  }
  if (receipt.writeback.bothStatesRead !== (receipt.writeback.afterStateRead === "ok")) {
    context.addIssue({ code: "custom", path: ["writeback", "bothStatesRead"], message: "bothStatesRead must exactly reflect a readable after-state." });
  }
  if (receipt.writeback.afterStateFreshness === "stale" && receipt.writeback.terminalDisposition === "success") {
    context.addIssue({ code: "custom", path: ["writeback", "terminalDisposition"], message: "A stale after-state is not success." });
  }
  if (receipt.writeback.terminalDisposition === "success" && receipt.writeback.intendedStateObservation !== "observed") {
    context.addIssue({ code: "custom", path: ["writeback", "terminalDisposition"], message: "Success requires observed intended state." });
  }
  // `noop` is intent-relative: nothing was written because the catalog already
  // held what was intended. That is only sayable when the before-state already
  // carried everything intent asserted.
  //
  // This used to `JSON.stringify` the *rendered* `beforeState` and `intent`
  // display values and compare them. Two defects in one line. It compared
  // presentation, so it would break the next time copy changed. And it treated
  // every field of the rendered state as asserted — so a writeback that
  // deliberately declined to write a link, recording `linkOmittedBecause`, read
  // as intending the link's absence and therefore as mismatching a before-state
  // that already had one.
  //
  // Both committed golden fixtures failed on that, and it was invisible because
  // `select-adapter` threw for every non-placeholder mode, so nothing had ever
  // rendered the judge package through the adapter that will render it to a
  // judge. `beforeMatchedIntent` is derived in `writeback-axes` from the raw
  // receipt, where the asserted fields are still distinguishable from the
  // rendered string.
  if (receipt.writeback.terminalDisposition === "noop" && !receipt.writeback.beforeMatchedIntent) {
    context.addIssue({ code: "custom", path: ["writeback", "terminalDisposition"], message: "Noop is valid only when before-state already matched intent." });
  }
});

/**
 * Every evidence value in a receipt, in one place, so the placeholder refinement
 * cannot silently miss a field someone adds later.
 */
function evidenceValues(receipt: z.infer<typeof receiptSchema>): EvidenceValue[] {
  return [
    ...Object.values(receipt.provenance),
    ...Object.values(receipt.evaluation),
    receipt.writeback.intent,
    receipt.writeback.beforeState,
  ];
}

const cockpitViewModelBaseSchema = z.object({
  sourceMode: sourceModeSchema,
  route: cockpitRouteSchema,
  source: sourceSchema,
  read: readSchema,
  completeness: completenessSchema,
  resolutionDisposition: resolutionDispositionSchema,
  mutationAcceptance: mutationAcceptanceSchema,
  intendedStateObservation: intendedStateObservationSchema,
  terminalWritebackDisposition: terminalWritebackDispositionSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  unresolvedItems: z.array(z.string()),
  datasetIdentity: sourceClaimSchema,
  datasetIdentityIdentifier: identifierMetaSchema.optional(),
  producerPath: sourceClaimSchema,
  dbtFilePath: z.string().nullable(),
  projectPrefix: z.string().nullable(),
  repositoryEvidence: sourceClaimSchema,
  /**
   * The commit-pinned link to the producing file, carrying where it came from.
   *
   * This was once a bare nullable URL sourced only from the catalog, and
   * `externalUrl` is dropped at the official MCP boundary
   * (`evaluation/mcp-field-coverage.md`), so it was null on every real event —
   * a judge surface with a permanently missing link.
   *
   * It is now three states rather than a URL or nothing, because "here is a
   * link" and "here is a link the catalog gave me" are different claims and a
   * reader must not have to assume which one is on screen. See
   * `resolveViewSource` for why the constructed case is built at render time
   * instead of being stored in the frozen evidence contract.
   */
  viewSource: viewSourceSchema,
  impactEdges: z.array(impactEdgeSchema),
  planComparison: planComparisonSchema,
  receipt: receiptSchema,
});

export const cockpitViewModelSchema = cockpitViewModelBaseSchema.superRefine((model, context) => {
  if (model.completeness === "complete-against-pinned-manifest" && model.read !== "ok") {
    context.addIssue({ code: "custom", path: ["completeness"], message: "Completeness requires a successful read." });
  }
  if (model.source === "unavailable" && model.read === "ok") {
    context.addIssue({ code: "custom", path: ["read"], message: "An unavailable source cannot report a successful read." });
  }
  if (model.read === "failed" && model.resolutionDisposition === "exact") {
    context.addIssue({ code: "custom", path: ["resolutionDisposition"], message: "A failed read cannot resolve a source." });
  }
  if (model.resolutionDisposition === "exact" && model.source === "unavailable") {
    context.addIssue({ code: "custom", path: ["source"], message: "An unavailable source cannot be resolved." });
  }
  if (model.terminalWritebackDisposition === "success" &&
      (model.mutationAcceptance !== "accepted" || model.intendedStateObservation !== "observed")) {
    context.addIssue({ code: "custom", path: ["terminalWritebackDisposition"], message: "Success requires accepted and observed intent." });
  }
  if (model.terminalWritebackDisposition === "accepted-not-observed" &&
      (model.mutationAcceptance !== "accepted" || model.intendedStateObservation !== "not-observed")) {
    context.addIssue({ code: "custom", path: ["terminalWritebackDisposition"], message: "Accepted-not-observed requires accepted but unobserved intent." });
  }
  // The state strip and the receipt are two renderings of one set of stated
  // gaps. If they can drift, a judge reading the strip and a judge reading the
  // receipt are looking at different claims.
  if (model.unresolvedItems.length !== model.receipt.statedGaps.length
      || model.unresolvedItems.some((item, index) => {
        const gap = model.receipt.statedGaps[index];
        return !gap || item !== `${gap.field}: ${gap.reason}`;
      })) {
    context.addIssue({ code: "custom", path: ["unresolvedItems"], message: "Receipt stated gaps and cockpit unresolved items must match exactly." });
  }
  if (model.mutationAcceptance !== model.receipt.writeback.mutationResponse || model.intendedStateObservation !== model.receipt.writeback.intendedStateObservation || model.terminalWritebackDisposition !== model.receipt.writeback.terminalDisposition) {
    context.addIssue({ code: "custom", path: ["receipt", "writeback"], message: "Writeback axes must exactly match the receipt." });
  }
  // Placeholder evidence is refused at the boundary, not merely labelled above
  // it. `selectCockpitAdapter` already refuses to *select* the provisional
  // adapter outside placeholder mode; this refuses a model that carries
  // invented values regardless of which adapter produced it, so a committed
  // build cannot show a judge a value nobody observed.
  if (model.sourceMode !== "placeholder") {
    const invented = evidenceValues(model.receipt).filter((value) => value.state === "placeholder");
    if (invented.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["receipt"],
        message: `A ${model.sourceMode} model carries ${invented.length} placeholder receipt value(s); only a placeholder build may render invented evidence.`,
      });
    }
  }
});

export type CockpitViewModel = z.infer<typeof cockpitViewModelSchema>;
export type CockpitRoute = z.infer<typeof cockpitRouteSchema>;
export type SourceMode = z.infer<typeof sourceModeSchema>;
export type CockpitStateName = z.infer<typeof cockpitStateNameSchema>;
export type ClaimSource = z.infer<typeof claimSourceSchema>;
export type PlanComparisonView = z.infer<typeof planComparisonSchema>;
export type ViewSource = z.infer<typeof viewSourceSchema>;

export type ImpactEdge = z.infer<typeof impactEdgeSchema>;

export type StatedGap = z.infer<typeof statedGapSchema>;
export type MutationAcceptance = z.infer<typeof mutationAcceptanceSchema>;
export type IntendedStateObservation = z.infer<typeof intendedStateObservationSchema>;
export type TerminalWritebackDisposition = z.infer<typeof terminalWritebackDispositionSchema>;
export type PlanDelta = z.infer<typeof planDeltaSchema>;

export const sourceEventSchema = cockpitViewModelBaseSchema.omit({ sourceMode: true });
export type SourceEvent = z.infer<typeof sourceEventSchema>;
