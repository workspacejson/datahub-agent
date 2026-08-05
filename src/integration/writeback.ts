/**
 * OSS-safe enrichment writeback, and the receipt it produces.
 *
 * What gets written, and why this and nothing else:
 *
 *   A labelled link from the dataset to the file that produces it, pinned to an
 *   immutable commit.
 *
 * That is the seam this project exists to close, and it is the one enrichment
 * that survives every constraint at once. It is a fact the catalog can verify
 * by following the URL, not a number we invented. It uses `upsertLink`, which
 * is core OSS and inherently idempotent. It appears in the DataHub UI where a
 * reviewer already looks for context. And it never touches human-authored
 * fields.
 *
 * Deliberately NOT written:
 *
 *   - Any risk or fragility score. There is no defensible per-file measurement
 *     available, and publishing one into a catalog other people trust would be
 *     the least honest thing this project could do.
 *   - `description` / `editableProperties`. Those carry human text. A tool that
 *     overwrites them destroys evidence it did not create.
 *   - Anything under a `manual.*` path in the workspace.json artifact. Same
 *     reason, in the other direction.
 *
 * The evidence tier travels as a structured property rather than being folded
 * into the link label, so a consumer reads a typed value instead of parsing
 * prose.
 */

import { EVIDENCE_TIER_LATTICE } from "./change-impact-event.js";
import type { ChangeImpactEvent, EvidenceTier } from "./change-impact-event.js";

/** Stable identifier for the property this tool owns. */
export const EVIDENCE_TIER_PROPERTY_ID = "workspacejson_evidence_tier";

/**
 * The structured-property definition this tool requires the catalog to hold,
 * built from the lattice rather than restating it.
 *
 * Every sentence describing a tier comes from `EVIDENCE_TIER_LATTICE`, so the
 * definition a catalog is asked to hold and the derivation the code performs
 * cannot drift apart by editing one of them. That was possible until now: the
 * definition lived as string literals in the runner script, and the tier
 * correction changed the derivation in this package while the deployed
 * definition kept whatever wording it was created with.
 */
export const EVIDENCE_TIER_PROPERTY_DEFINITION = {
  qualifiedName: EVIDENCE_TIER_PROPERTY_ID,
  displayName: "Evidence tier (workspace.json)",
  description:
    "Mechanically derived from the evidence records supporting the dataset-to-code resolution. " +
    EVIDENCE_TIER_LATTICE.map(({ tier, rule }) => `${tier}: ${rule}.`).join(" "),
  valueTypeUrn: "urn:li:dataType:datahub.string",
  cardinality: "SINGLE",
  entityTypeUrns: ["urn:li:entityType:datahub.dataset"],
  allowedValues: EVIDENCE_TIER_LATTICE.map(({ tier, rule }) => ({
    stringValue: tier,
    description: rule,
  })),
} as const;

/**
 * A structured-property definition as the catalog reports it.
 *
 * Every field is nullable because this is a *reading*, not a construction. A
 * catalog that answers with a missing description is telling us something, and
 * coercing that to `""` here would let it compare equal to a definition that
 * genuinely carries no description.
 */
export interface DeployedPropertyDefinition {
  displayName: string | null;
  description: string | null;
  cardinality: string | null;
  valueTypeUrn: string | null;
  entityTypeUrns: readonly string[];
  allowedValues: readonly { stringValue: string; description: string | null }[];
}

export interface DefinitionReconciliation {
  reconciled: boolean;
  /** One line per divergence, each naming the required and deployed values. */
  problems: string[];
}

/** `null` and `undefined` both read as "the catalog said nothing here". */
const shown = (value: string | null): string => (value === null ? "(none)" : JSON.stringify(value));

/**
 * Compare the deployed definition against the one this tool requires.
 *
 * Detection only. Nothing here repairs, migrates or overwrites deployed
 * catalog state: a definition that disagrees is an operator's decision to
 * make, and a tool that silently rewrote it would be destroying metadata it
 * does not own for the sake of its own convenience — the thing this module
 * refuses to do everywhere else.
 *
 * `null` means the definition could not be read, and that is a failure rather
 * than a skip. An unreadable definition is precisely the state where writing
 * tier values is least defensible, because nothing is known about what those
 * values will be interpreted to mean.
 *
 * Order is not compared. Allowed values are matched by their token and entity
 * types as a set, because neither carries meaning in its position — the
 * cardinality is `SINGLE`, so an allowed value is selected by name and never
 * by index. Comparing order would fail closed on a catalog that agrees.
 */
export function reconcileDeployedDefinition(
  deployed: DeployedPropertyDefinition | null,
): DefinitionReconciliation {
  if (deployed === null) {
    return {
      reconciled: false,
      problems: [
        `the deployed definition of ${EVIDENCE_TIER_PROPERTY_ID} could not be read, so it cannot be reconciled`,
      ],
    };
  }

  const required = EVIDENCE_TIER_PROPERTY_DEFINITION;
  const problems: string[] = [];

  const scalars = [
    ["displayName", required.displayName, deployed.displayName],
    ["description", required.description, deployed.description],
    ["cardinality", required.cardinality, deployed.cardinality],
    ["valueType", required.valueTypeUrn, deployed.valueTypeUrn],
  ] as const;
  for (const [field, want, got] of scalars) {
    if (want !== got) problems.push(`${field}: required ${shown(want)}, deployed ${shown(got)}`);
  }

  const wantEntities = [...required.entityTypeUrns].sort();
  const gotEntities = [...deployed.entityTypeUrns].sort();
  if (JSON.stringify(wantEntities) !== JSON.stringify(gotEntities)) {
    problems.push(
      `entityTypes: required ${JSON.stringify(wantEntities)}, deployed ${JSON.stringify(gotEntities)}`,
    );
  }

  const deployedValues = new Map(deployed.allowedValues.map((v) => [v.stringValue, v.description]));
  for (const { stringValue, description } of required.allowedValues) {
    if (!deployedValues.has(stringValue)) {
      problems.push(`allowedValues: required value ${JSON.stringify(stringValue)} is not deployed`);
      continue;
    }
    const got = deployedValues.get(stringValue) ?? null;
    if (got !== description) {
      problems.push(
        `allowedValues[${stringValue}]: required ${shown(description)}, deployed ${shown(got)}`,
      );
    }
  }
  const requiredTokens = new Set<string>(required.allowedValues.map((v) => v.stringValue));
  for (const { stringValue } of deployed.allowedValues) {
    if (!requiredTokens.has(stringValue)) {
      problems.push(
        `allowedValues: deployed value ${JSON.stringify(stringValue)} is not part of the evidence lattice`,
      );
    }
  }

  return { reconciled: problems.length === 0, problems };
}

export interface WritebackTarget {
  gmsUrl: string;
  /** Present only when the instance requires it; quickstart does not. */
  token?: string | undefined;
}

export interface MutationAttempt {
  /** The GraphQL mutation invoked, by name. */
  mutation: string;
  /** Variables sent, with any token redacted before it reaches a receipt. */
  variables: Record<string, unknown>;
  succeeded: boolean;
  /** Raw response or error text, truncated. Recorded either way. */
  response: string;
}

/**
 * Why the fields of a `CatalogState` are or are not claims about the catalog.
 *
 * This is deliberately the same three-way vocabulary the change-impact contract
 * uses for `UnavailableReason`, minus `absent` — because here the absence of a
 * link is carried by `linkUrl: null` under `read: "ok"`, which *is* the positive
 * claim. The two non-claims are kept apart for the same reason they are there:
 *
 *   ok           the catalog answered; the fields below are its answer
 *   failed       we asked and did not get an answer
 *   not-queried  we chose not to ask
 *
 * Collapsing `not-queried` into `failed` reports a deliberate decision as a
 * fault — the identical error, in the opposite direction, to reporting a fault
 * as an answer.
 */
export type ReadStatus = "ok" | "failed" | "not-queried";

/**
 * The catalog state this writeback observed, on one side of the write.
 *
 * `read` exists because a null `linkUrl` is otherwise several different facts
 * wearing the same face: the catalog answered and holds no link, the catalog
 * never answered, or nobody asked. That is the same distinction the
 * change-impact contract draws between `absent`, `failed` and `not-queried`,
 * and collapsing it here would let an unreadable instance be recorded as an
 * empty one — a before/after pair showing a clean write that never happened.
 */
export interface CatalogState {
  linkUrl: string | null;
  evidenceTier: EvidenceTier | null;
  /** Whether the catalog answered. Unless "ok", the fields above are not claims. */
  read: ReadStatus;
  /** What went wrong, or why nothing was asked. Null only when the read is "ok". */
  readError: string | null;
}

/** A state that could not be read. The nulls are explicitly not assertions. */
export function unreadableState(error: string): CatalogState {
  return { linkUrl: null, evidenceTier: null, read: "failed", readError: error };
}

/**
 * A state nobody asked for. Distinct from `unreadableState`: a dry run declining
 * to read is a decision, not a failure, and a receipt that calls it a failure is
 * lying about its own behaviour.
 */
export function notQueriedState(why: string): CatalogState {
  return { linkUrl: null, evidenceTier: null, read: "not-queried", readError: why };
}

/**
 * The state the writeback is trying to bring about.
 *
 * Without this the receipt can only compare its two observations to each other,
 * and a before/after pair has no opinion about whether either one is *right*.
 * Every claim the receipt makes is relative to this.
 */
export interface WritebackIntent {
  /**
   * Null when no commit-pinned URL was obtainable and the writeback proceeded
   * on the evidence tier alone. It means "this operation made no claim about
   * the link", so `matchesIntent` does not compare it — requiring the catalog
   * to hold no link would assert the opposite of what was intended.
   */
  linkUrl: string | null;
  evidenceTier: EvidenceTier;
}

/**
 * How the after-state came to be observed.
 *
 * A mutation can return cleanly and still not be visible for minutes — the
 * index-convergence lag measured in HAC-221. So the after-state is polled until
 * it matches intent or a bound elapses, and this records which of those
 * happened. It is a separate vocabulary from `ReadStatus` on purpose: a read
 * that succeeded but showed a stale answer is `ok` and `timed-out` at once, and
 * overloading one field to say both would lose exactly the distinction this
 * issue exists to draw.
 *
 *   settled     the after-state was observed carrying the intended values
 *   timed-out   reads succeeded, but never showed intent within the bound
 *   failed      the final read did not complete
 */
export type ObservationStatus = "settled" | "timed-out" | "failed";

export interface ObservationRecord {
  status: ObservationStatus;
  /** How many times the after-state was read. Always at least one. */
  polls: number;
  /** Wall-clock spent observing, so a slow convergence is visible as a cost. */
  elapsedMs: number;
  /** The bound that was applied, so a timeout can be read against it. */
  timeoutMs: number;
  /** The read error, when the final read failed. */
  lastError: string | null;
}

/**
 * A receipt is emitted whether or not the write succeeded. A writeback that
 * fails silently is worse than one that fails loudly, and a reviewer needs to
 * see the failure as readily as the success.
 */
export interface WritebackReceipt {
  targetUrn: string;
  actor: { tool: string; version: string };
  attemptedAt: string;
  /** Revision the enrichment was derived from. */
  revision: { repository: string | null; commit: string | null };
  /** What the write was for. Null only when there was nothing to write. */
  intended: WritebackIntent | null;
  before: CatalogState;
  after: CatalogState;
  attempts: MutationAttempt[];
  /** How the after-state was observed. Null when nothing was applied. */
  observation: ObservationRecord | null;
  /**
   * True only when every mutation succeeded AND the after-state was observed
   * carrying the intended link and tier. Mutations returning cleanly is not
   * evidence that the write is visible.
   */
  succeeded: boolean;
  /** True when the before-state already matched intent, and still does. */
  noop: boolean;
  /**
   * True when both states were read. This says the observations exist — it says
   * nothing about whether they show what was intended. That is `succeeded`.
   *
   * Named for the reads rather than graded, because as `verified` it was
   * routinely read as the receipt's verdict when it is merely the precondition
   * for having one. A receipt showing `verified: true` beside `succeeded: false`
   * looks self-contradictory and is not: both states were read, and they did not
   * show intent. `bothStatesRead: true, succeeded: false` states the same pair of
   * facts without the appearance of conflict — and, unlike `verified`, it cannot
   * be quoted on its own as though it settled anything.
   */
  bothStatesRead: boolean;
  /** Why the writeback did not proceed, when it did not. */
  refusedBecause: string | null;
  /**
   * Why no source link was written, when the enrichment proceeded without one.
   *
   * Distinct from `refusedBecause`: that says nothing happened, this says
   * something happened with one part deliberately left out. A receipt showing a
   * landed enrichment and no link would otherwise leave a reader unable to tell
   * a declined link from a forgotten one.
   */
  linkOmittedBecause: string | null;
}

/**
 * What this event asks the catalog to hold. Null when there is nothing to write,
 * which is the same condition `refusalReason` reports in prose.
 */
export function intendedState(event: ChangeImpactEvent): WritebackIntent | null {
  // Null only when the writeback is refused outright. A missing source URL is
  // not that: the tier is still being written, so there is still an intended
  // state to observe against — and returning null here would leave a real
  // mutation with nothing to verify it landed.
  if (refusalReason(event) !== null) return null;
  return { linkUrl: event.code.sourceUrl, evidenceTier: event.evidence.tier };
}

/**
 * Whether an observed state carries what the writeback set out to establish.
 *
 * False on any state that is not `read: "ok"` — a state nobody read cannot
 * match anything, and treating its nulls as a comparison would turn an
 * unobserved write into a confident verdict either way.
 */
export function matchesIntent(state: CatalogState, intent: WritebackIntent): boolean {
  if (state.read !== "ok") return false;
  // A null `linkUrl` intent means no link was written, not that the catalog
  // must hold none. Comparing it as a value made the observation demand the
  // absence of a link the writeback never touched — so an enrichment that
  // landed cleanly could never be observed as settled, and a live run polled to
  // its bound and reported `timed-out` on a write that had already succeeded.
  //
  // That is the same overreach in the opposite direction: asserting something
  // about a field this operation made no claim on.
  const linkMatches = intent.linkUrl === null || state.linkUrl === intent.linkUrl;
  return linkMatches && state.evidenceTier === intent.evidenceTier;
}

/**
 * Whether the write changed nothing because the state was already correct.
 *
 * Intent-relative rather than a before/after equality check: comparing the two
 * observations to each other cannot tell "already correct" from "unchanged and
 * wrong", and only the first is evidence of idempotency. Never true on a state
 * that was not read — "nothing changed" and "we could not tell whether anything
 * changed" are different claims.
 */
export function isNoop(
  before: CatalogState,
  after: CatalogState,
  intent: WritebackIntent,
): boolean {
  return matchesIntent(before, intent) && matchesIntent(after, intent);
}

/** Everything the receipt's verdict is derived from. */
export interface OutcomeInput {
  refusedBecause: string | null;
  intent: WritebackIntent | null;
  before: CatalogState;
  after: CatalogState;
  attempts: MutationAttempt[];
}

export interface WritebackOutcome {
  succeeded: boolean;
  noop: boolean;
  bothStatesRead: boolean;
}

/**
 * Derive the receipt's three verdicts from the evidence, in one place.
 *
 * This lives here rather than inline in the runner script because it is the
 * only part of the writeback that makes a *claim*, and a claim that cannot be
 * tested without a live catalog is a claim nobody checks.
 */
export function deriveOutcome({
  refusedBecause,
  intent,
  before,
  after,
  attempts,
}: OutcomeInput): WritebackOutcome {
  const bothStatesRead = before.read === "ok" && after.read === "ok";
  if (refusedBecause !== null || intent === null) {
    return { succeeded: false, noop: false, bothStatesRead };
  }
  return {
    succeeded:
      attempts.length > 0 && attempts.every((a) => a.succeeded) && matchesIntent(after, intent),
    noop: isNoop(before, after, intent),
    bothStatesRead,
  };
}

export const LINK_LABEL = "Producing source (workspace.json)" as const;

/**
 * Decide whether an event carries enough to enrich from.
 *
 * Returns a refusal reason rather than a boolean, so the receipt can say what
 * was missing instead of reporting a bare failure.
 */
export function refusalReason(event: ChangeImpactEvent): string | null {
  if (event.code.method === "unresolved") {
    return "the producing file could not be resolved, so there is no enrichment to attach";
  }
  if (!event.provenance.corpus.commit) {
    return "the source revision is unknown, so the enrichment could not be attributed to a commit";
  }
  // A missing source URL is deliberately *not* here.
  //
  // It used to refuse the whole writeback, which suppressed the evidence-tier
  // mutation as well — a mutation that reads only the subject URN and the
  // derived tier, and never touches the URL. So an optional field's absence was
  // escalating into refusal of an operation it has no bearing on, and the half
  // being dropped was the half carrying the actual evidence.
  //
  // That is the same absence-collapse this contract exists to prevent, one
  // layer up: "cannot do all of it" read as "cannot do any of it". The link is
  // what lets a human click through to an exact file; it is not what makes the
  // annotation worth writing. `linkOmission` states why it was left out, so the
  // receipt shows a scoped omission rather than a silent one.
  return null;
}

/**
 * Why no source link accompanies an otherwise-permitted writeback.
 *
 * Null when a link is being written. A string here is a stated omission, and it
 * belongs in the receipt: a judge seeing an enrichment land without a link is
 * entitled to know the link was declined rather than forgotten.
 */
export function linkOmission(event: ChangeImpactEvent): string | null {
  if (event.code.sourceUrl) return null;
  return "no commit-pinned source URL is available; an unpinned link would drift from the artifact it describes, so none was written";
}

/**
 * Build the exact mutations a writeback would issue, without sending them.
 *
 * Separated from execution so the plan is inspectable in a dry run and
 * assertable in a test without a live instance. The cockpit shows this as the
 * "will write" half of the receipt.
 */
export function planWriteback(
  event: ChangeImpactEvent,
): Array<Pick<MutationAttempt, "mutation" | "variables">> {
  const sourceUrl = event.code.sourceUrl;

  return [
    // The link is conditional; the evidence tier is not. Returning `[]` for both
    // when the URL is missing dropped a mutation that depends on neither the URL
    // nor anything derived from it.
    ...(sourceUrl
      ? [{
          mutation: "upsertLink" as const,
          variables: {
            input: {
              resourceUrn: event.subject.urn,
              linkUrl: sourceUrl,
              label: LINK_LABEL,
            },
          },
        }]
      : []),
    // `upsertStructuredProperties` merges; it does not replace the aspect.
    //
    // Worth stating because DataHub's own tutorial says the opposite. The
    // "Set Structured Property To a Dataset" page reads "This action will
    // set/replace all structured properties on the entity", which describes the
    // aspect-level OpenAPI write, not this mutation. Taken at face value it
    // makes the call below look like it deletes every foreign property on the
    // dataset, which is why HAC-269 was filed as a P0.
    //
    // The resolver at the pinned tag `v1.5.0.6` does the opposite. It reads the
    // existing aspect, maps over the current assignments and returns each one
    // untouched unless its URN appears in the input, appends only URNs that were
    // not already present, and ingests the merged array:
    //
    //   UpsertStructuredPropertiesResolver.java:87   read existing aspect
    //                                         :91    updateExistingProperties
    //                                         :94    addNewProperties
    //
    // So naming one property here mutates that one property. A foreign property
    // survives. The same holds for `upsertLink` above, which appends to
    // institutional memory via LinkUtils rather than setting it.
    //
    // Two things this does NOT license, both unproven here:
    //   - Atomicity. The merge is a server-side read-modify-write, so two
    //     concurrent writers to one dataset can still lose an update. Narrower
    //     than a clobber, and not addressed.
    //   - The OpenAPI aspect PUT. That surface is where the documented replace
    //     appears to apply, so porting this to it would introduce the very bug
    //     the tutorial warns about.
    //
    // Re-read the resolver before changing the pinned GMS version; this is a
    // property of that implementation, not a guarantee of the GraphQL contract.
    {
      mutation: "upsertStructuredProperties",
      variables: {
        input: {
          assetUrn: event.subject.urn,
          structuredPropertyInputParams: [
            {
              structuredPropertyUrn: `urn:li:structuredProperty:${EVIDENCE_TIER_PROPERTY_ID}`,
              values: [{ stringValue: event.evidence.tier }],
            },
          ],
        },
      },
    },
  ];
}

/** Strip anything that must not appear in a receipt a reviewer can copy. */
export function redact(variables: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(variables)) as Record<string, unknown>;
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (/token|secret|password|authorization/i.test(key)) {
        (node as Record<string, unknown>)[key] = "[redacted]";
      } else {
        walk(value);
      }
    }
  };
  walk(clone);
  return clone;
}

/**
 * Fold the receipt into the event so a single artifact carries the read, the
 * join, the evidence and the write. The cockpit and the golden fixture both
 * consume one shape rather than correlating two.
 */
export interface EnrichedChangeImpactEvent extends ChangeImpactEvent {
  writeback: WritebackReceipt | null;
}

export function attachReceipt(
  event: ChangeImpactEvent,
  receipt: WritebackReceipt | null,
): EnrichedChangeImpactEvent {
  return { ...event, writeback: receipt };
}
