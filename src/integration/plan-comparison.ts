/**
 * The plan-comparison contract: what the agent *derived*, kept apart from what
 * the catalog was *observed* to hold.
 *
 * Why this is a separate contract rather than fields on `ChangeImpactEvent`:
 *
 * The event is an evidence input. Every field in it is something a system was
 * asked and answered, carried beside the standing of that answer. A plan is not
 * that — it is what a model produced when handed the evidence, and a delta
 * between two plans is an inference about an inference. Folding them into the
 * event would make one artifact that is partly observation and partly
 * derivation, with no field telling a reader which half they are looking at.
 * That is the same conflation the evidence vocabulary exists to prevent, one
 * level up, and it would arrive inside the very contract built to prevent it.
 *
 * So `CHANGE_IMPACT_EVENT_VERSION` stays at 1.3 and is not bumped. This artifact
 * is versioned on its own, and a `JudgeRunBundle` carries the two together with
 * a digest binding them.
 *
 * What the binding is for:
 *
 * A plan comparison is only meaningful relative to the exact evidence it was
 * derived from. Two plans compared against *different* evidence differ for
 * reasons nobody can attribute — and the whole claim of this project is that the
 * joined plan differs *because of* the joined evidence. `eventDigest` makes that
 * checkable rather than asserted: a comparison whose digest does not match the
 * event beside it is refused, not rendered with a caveat.
 *
 * The symmetric requirement is that both plans came from one setup. If the
 * DataHub-only plan and the joined plan were produced under different prompts,
 * models or settings, then any delta between them is confounded and the artifact
 * is evidence of nothing. Each plan therefore records the identity it was
 * produced under, and validation refuses the pair when they differ — rather than
 * recording one identity for both and trusting the producer to have meant it.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { validateEvent, type ChangeImpactEvent } from "./change-impact-event.js";

/** The version consumers of this artifact compile against. */
export const PLAN_COMPARISON_VERSION = "1.0" as const;

/** The version of the bundle that carries an event and a comparison together. */
export const JUDGE_RUN_BUNDLE_VERSION = "1.0" as const;

/**
 * The setup a plan was produced under.
 *
 * Recorded per plan, not once per artifact. An artifact carrying a single
 * identity asserts that both plans shared it; carrying one each *shows* whether
 * they did, and lets validation say so.
 */
export interface RunIdentity {
  /** The change request. Identical across both modes or the delta is confounded. */
  taskId: string;
  /** Digest of the exact prompt text, so a reworded prompt is a different run. */
  promptDigest: string;
  /** The model identifier, verbatim. */
  model: string;
  /** Digest of decoding settings — temperature, top-p, seed, and anything else. */
  settingsDigest: string;
}

/** Which context a plan was produced from. */
export type PlanMode = "datahub-only" | "joined";

export interface PlanStep {
  /** Stable within one plan, so a reordering can be expressed by identity. */
  id: string;
  /** What the step does, in the agent's own words. */
  action: string;
}

export interface Plan {
  mode: PlanMode;
  /** Order is significant: it is what a `reordered` delta refers to. */
  steps: PlanStep[];
  run: RunIdentity;
}

/**
 * The kinds of semantic change the joined context can make to a plan.
 *
 * Deliberately the same five the cockpit already speaks, so the carrier and the
 * surface cannot drift apart into two vocabularies for one idea.
 */
export type PlanDeltaKind = "added" | "removed" | "reordered" | "constrained" | "uncertainty-changed";

/**
 * A reference into the event's evidence, as a dotted path.
 *
 * A string rather than an inlined copy, so a delta cannot cite evidence the
 * event does not contain. Validation resolves every reference against the bound
 * event; an unresolvable one fails the bundle.
 */
export type EvidenceRef = string;

export interface PlanDelta {
  kind: PlanDeltaKind;
  /** What changed, as a reader would name it. */
  label: string;
  /** Why the joined context caused it. Prose, and required. */
  reason: string;
  /**
   * What in the event backs this. **Never empty.**
   *
   * A delta with no evidence reference is an assertion that the joined context
   * changed the plan, with nothing behind it — which is precisely the claim this
   * project exists to refuse making. Enforced rather than encouraged.
   */
  evidenceRefs: EvidenceRef[];
}

export interface PlanComparisonArtifact {
  artifactVersion: typeof PLAN_COMPARISON_VERSION;
  /** Binds this comparison to exactly one validated 1.3 event. */
  eventDigest: string;
  /** What the two plans were produced against. */
  snapshot: {
    repository: string;
    revision: string;
    /** The catalog state the evidence came from, as the event recorded it. */
    datahub: { gmsUrl: string; eventProducedAt: string };
  };
  datahubOnlyPlan: Plan;
  joinedPlan: Plan;
  /**
   * The semantic differences. An empty array is a real result — an observed
   * comparison that found no delta — and is **not** the same as no comparison
   * existing. That distinction is carried by the consumer's
   * `observed | unavailable` state, never by the emptiness of this array.
   */
  deltas: PlanDelta[];
}

export interface JudgeRunBundle {
  bundleVersion: typeof JUDGE_RUN_BUNDLE_VERSION;
  event: ChangeImpactEvent;
  comparison: PlanComparisonArtifact;
}

// ---------------------------------------------------------------------------
// Digest
// ---------------------------------------------------------------------------

/** Key order must not change a digest; two equal events must digest equally. */
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

/**
 * The fields the digest covers, enumerated rather than taken from the object.
 *
 * `canonicalJson` walks every own key, and the events this runs against are not
 * always bare `ChangeImpactEvent`s: the emitter attaches a writeback receipt,
 * producing an `EnrichedChangeImpactEvent` with a tenth key. Digesting whatever
 * keys happened to be present meant a typed producer building a bare event and a
 * consumer parsing the emitted JSON would compute **different digests for the
 * same evidence**, and the binding would fail for a reason neither could see.
 *
 * Enumerating them fixes that, and is the semantically right scope besides. The
 * comparison is derived from the *evidence*; the writeback is a later action
 * taken on the strength of it. A receipt arriving afterwards must not invalidate
 * a comparison that was correctly derived before it existed.
 */
const DIGESTED_EVENT_FIELDS = [
  "eventVersion",
  "provenance",
  "subject",
  "datahub",
  "code",
  "partners",
  "evidence",
  "accounting",
  "unavailable",
] as const;

/**
 * The digest a comparison must carry to claim it was derived from this event.
 *
 * Accepts an enriched event as well as a bare one, and gives both the same
 * answer — see `DIGESTED_EVENT_FIELDS`.
 */
export function digestEvent(event: ChangeImpactEvent): string {
  const source = event as unknown as Record<string, unknown>;
  const scoped: Record<string, unknown> = {};
  for (const field of DIGESTED_EVENT_FIELDS) {
    if (field in source) scoped[field] = source[field];
  }
  return createHash("sha256").update(canonicalJson(scoped)).digest("hex");
}

/** Whether two plans were produced under the same setup, field by field. */
export function sameRunIdentity(a: RunIdentity, b: RunIdentity): boolean {
  return (
    a.taskId === b.taskId &&
    a.promptDigest === b.promptDigest &&
    a.model === b.model &&
    a.settingsDigest === b.settingsDigest
  );
}

// ---------------------------------------------------------------------------
// Evidence references
// ---------------------------------------------------------------------------

/**
 * The paths a delta may cite.
 *
 * Enumerated from the event rather than parsed as a general expression, because
 * a general resolver would accept `code` or `provenance` — paths that exist but
 * are not evidence, and citing them would let a delta look supported while
 * pointing at a field that supports nothing.
 */
export function evidenceRefsOf(event: ChangeImpactEvent): Set<EvidenceRef> {
  const refs = new Set<EvidenceRef>();
  event.evidence.records.forEach((_, index) => refs.add(`evidence.records[${index}]`));
  event.unavailable.forEach((entry, index) => {
    refs.add(`unavailable[${index}]`);
    // Also addressable by field, because that is how a reader cites it. Both
    // forms resolve to the same entry; neither invents one.
    refs.add(`unavailable[${JSON.stringify(entry.field)}]`);
  });
  event.partners.forEach((_, index) => refs.add(`partners[${index}]`));
  event.datahub.upstreams.forEach((_, index) => refs.add(`datahub.upstreams[${index}]`));
  event.datahub.downstreams.forEach((_, index) => refs.add(`datahub.downstreams[${index}]`));
  refs.add("datahub.lineageObservation.upstreams");
  refs.add("datahub.lineageObservation.downstreams");
  return refs;
}

// ---------------------------------------------------------------------------
// Placeholder detection
// ---------------------------------------------------------------------------

/**
 * Text that means the pipeline did not run, wearing the shape of a result.
 *
 * This exists because the repository already shipped one:
 * `provisional-source.ts` carries a delta reading `<joined plan unavailable>`,
 * which is honest where it lives — a provisional adapter — and would be a lie in
 * a judge-facing artifact. Scaffolding migrating into a real artifact is a
 * routine failure, not a hypothetical one, and it is cheap to refuse.
 */
const PLACEHOLDER_PATTERNS = [
  /^<.*>$/,
  /\bTODO\b/i,
  /\bTBD\b/i,
  /\bFIXME\b/i,
  /\bplaceholder\b/i,
  /\blorem ipsum\b/i,
  /\bexample\.(com|test)\b/i,
];

/**
 * Two words were removed from that list, and the reason generalises.
 *
 * `unavailable` and `provisional` were there to catch
 * `<joined plan unavailable>`. They caught it — and also every legitimate
 * sentence containing either word, of which this domain has many, because
 * `unavailable` is a **first-class field name on the event contract**. A delta
 * reasoning "the catalog reported the upstream unavailable, so the plan adds a
 * verification step" is exactly the evidence-backed reason this artifact exists
 * to carry, and it was being rejected as scaffolding.
 *
 * `^<.*>$` already catches the angle-bracket form, which is the shape the
 * placeholder actually takes. So the list matches placeholder *shapes* and
 * unambiguous authoring markers, never ordinary domain vocabulary. A detector
 * that fires on the words a real answer would use is not a strict detector, it
 * is a broken one — and it fails in the direction that looks like rigour.
 */

export function looksLikePlaceholder(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * The runtime shape, because the callers that matter are untyped.
 *
 * `validateEvent` takes `unknown` and runs a Zod pass before checking any
 * invariant, for a stated reason: every producer of these artifacts is an
 * untyped `.mjs` script, so "required" otherwise means "required of callers who
 * happened to be writing TypeScript" — and none of the ones that matter are.
 *
 * This contract had the same producers and did not follow the pattern. It read
 * fields straight off a typed parameter, so a malformed artifact from a script
 * threw a `TypeError` out of the validator instead of being returned as a
 * problem — the exact failure mode the event's validator was built to prevent,
 * reproduced in the contract added to sit beside it.
 *
 * `.strict()` throughout, for the same reason it is used there: an unknown key
 * is a field no consumer is documented to expect, riding inside an artifact
 * whose entire purpose is that its claims can be trusted.
 */
const runIdentitySchema = z
  .strictObject({
    taskId: z.string().min(1),
    promptDigest: z.string().min(1),
    model: z.string().min(1),
    settingsDigest: z.string().min(1),
  })
  .describe("RunIdentity");

const planSchema = z.strictObject({
  mode: z.enum(["datahub-only", "joined"]),
  steps: z.array(z.strictObject({ id: z.string().min(1), action: z.string() })),
  run: runIdentitySchema,
});

const planDeltaSchema = z.strictObject({
  kind: z.enum(["added", "removed", "reordered", "constrained", "uncertainty-changed"]),
  label: z.string(),
  reason: z.string(),
  evidenceRefs: z.array(z.string()),
});

const planComparisonSchema = z.strictObject({
  artifactVersion: z.literal(PLAN_COMPARISON_VERSION),
  eventDigest: z.string().min(1),
  snapshot: z.strictObject({
    repository: z.string().min(1),
    revision: z.string().min(1),
    datahub: z.strictObject({ gmsUrl: z.string().min(1), eventProducedAt: z.string().min(1) }),
  }),
  datahubOnlyPlan: planSchema,
  joinedPlan: planSchema,
  deltas: z.array(planDeltaSchema),
});

const judgeRunBundleSchema = z.strictObject({
  bundleVersion: z.literal(JUDGE_RUN_BUNDLE_VERSION),
  event: z.unknown(),
  comparison: planComparisonSchema,
});

/**
 * Check a bundle, returning every problem rather than the first.
 *
 * Takes `unknown`, so a producer that is not TypeScript still gets a list of
 * problems rather than an exception. Returns strings so a caller can print them
 * all at once, matching `validateEvent`: a reviewer fixing one should see the
 * other three in the same run.
 */
export function validateBundle(candidate: unknown): string[] {
  const shape = judgeRunBundleSchema.safeParse(candidate);
  if (!shape.success) {
    // Structural problems are returned alone. Running the invariant checks over
    // an object that failed its shape would report a cascade of consequences and
    // bury the cause.
    return shape.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
  }

  const problems: string[] = [];
  const bundle = shape.data as unknown as JudgeRunBundle;
  const { event, comparison } = bundle;

  // The bundled event must itself be valid.
  //
  // The digest proves the comparison was derived from *this* event. It says
  // nothing about whether this event is one anybody should reason from — an
  // event whose accounting does not reconcile, or whose tier contradicts its
  // records, digests perfectly well. Without this, a bundle carrying a refused
  // event was presented as `observed`, and the comparison inherited a
  // credibility its input never had.
  for (const problem of validateEvent(event)) {
    problems.push(`event: ${problem}`);
  }

  // The binding. A comparison derived from different evidence than the event it
  // travels with makes every delta unattributable.
  const expectedDigest = digestEvent(event);
  if (comparison.eventDigest !== expectedDigest) {
    problems.push(
      `eventDigest ${comparison.eventDigest} does not match the bundled event (${expectedDigest}); ` +
        `the comparison was derived from different evidence`,
    );
  }

  // Both plans, one setup. Otherwise a delta is confounded by the setup change
  // and says nothing about the joined context.
  if (!sameRunIdentity(comparison.datahubOnlyPlan.run, comparison.joinedPlan.run)) {
    problems.push(
      "the two plans were produced under different task, prompt, model, or settings identities, " +
        "so any delta between them is confounded",
    );
  }

  if (comparison.datahubOnlyPlan.mode !== "datahub-only") {
    problems.push(`datahubOnlyPlan.mode is ${comparison.datahubOnlyPlan.mode}, expected datahub-only`);
  }
  if (comparison.joinedPlan.mode !== "joined") {
    problems.push(`joinedPlan.mode is ${comparison.joinedPlan.mode}, expected joined`);
  }

  // A comparison against evidence with no corpus identity is meaningless, and
  // says so rather than failing as a string/null mismatch.
  //
  // `snapshot.repository` and `.revision` are non-null by design: a plan delta
  // attributed to "the joined context" is attributed to code, and code nobody
  // can name is not something a judge can check. But the event's corpus fields
  // are nullable, so the comparison below would have reported "does not match"
  // for an event that simply never knew its own corpus — a true statement about
  // the wrong problem, leaving a reader hunting a mismatch that does not exist.
  if (event.provenance.corpus.repository === null || event.provenance.corpus.commit === null) {
    problems.push(
      "the bundled event carries no corpus identity (provenance.corpus.repository or .commit is null), " +
        "so a plan delta cannot be attributed to any code and no comparison can be bound to it",
    );
  } else {
    // The snapshot must describe the event's own corpus, not a second opinion.
    if (comparison.snapshot.repository !== event.provenance.corpus.repository) {
      problems.push("snapshot.repository does not match the event's corpus repository");
    }
    if (comparison.snapshot.revision !== event.provenance.corpus.commit) {
      problems.push("snapshot.revision does not match the event's corpus commit");
    }
  }
  if (comparison.snapshot.datahub.gmsUrl !== event.provenance.datahub.gmsUrl) {
    problems.push("snapshot.datahub.gmsUrl does not match the event's DataHub identity");
  }
  if (comparison.snapshot.datahub.eventProducedAt !== event.provenance.producedAt) {
    problems.push("snapshot.datahub.eventProducedAt does not match the event's producedAt");
  }

  const available = evidenceRefsOf(event);
  comparison.deltas.forEach((delta, index) => {
    if (delta.evidenceRefs.length === 0) {
      problems.push(
        `deltas[${index}] (${delta.kind}: ${delta.label}) cites no evidence; ` +
          "a plan change asserted with nothing behind it is the claim this contract refuses",
      );
    }
    for (const ref of delta.evidenceRefs) {
      if (!available.has(ref)) {
        problems.push(`deltas[${index}] cites ${ref}, which the bundled event does not contain`);
      }
    }
    if (looksLikePlaceholder(delta.label)) {
      problems.push(`deltas[${index}].label is placeholder text: ${JSON.stringify(delta.label)}`);
    }
    if (looksLikePlaceholder(delta.reason)) {
      problems.push(`deltas[${index}].reason is placeholder text: ${JSON.stringify(delta.reason)}`);
    }
  });

  for (const [name, plan] of [
    ["datahubOnlyPlan", comparison.datahubOnlyPlan],
    ["joinedPlan", comparison.joinedPlan],
  ] as const) {
    if (plan.steps.length === 0) {
      problems.push(`${name} has no steps; an empty plan is not a plan`);
    }
    const ids = new Set<string>();
    plan.steps.forEach((step, index) => {
      if (looksLikePlaceholder(step.action)) {
        problems.push(`${name}.steps[${index}].action is placeholder text: ${JSON.stringify(step.action)}`);
      }
      if (ids.has(step.id)) {
        problems.push(`${name}.steps[${index}].id ${JSON.stringify(step.id)} is not unique within the plan`);
      }
      ids.add(step.id);
    });
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Consumer state
// ---------------------------------------------------------------------------

/**
 * What a consumer holds: a comparison, or a stated reason it has none.
 *
 * The two are separate shapes rather than one shape with an empty array,
 * because an empty delta array has exactly one honest meaning — *an observed
 * comparison found no semantic difference* — and it was being used for a second
 * one: no comparison exists at all. Those call for opposite readings. The first
 * is a finding about the joined context; the second is a missing input.
 *
 * The cockpit rendered `planDeltas: []` for both, which is how "no comparison
 * has ever been produced" came to look like "the joined context changed
 * nothing".
 */
export type PlanComparisonState =
  | { status: "observed"; comparison: PlanComparisonArtifact }
  | { status: "unavailable"; reason: string };

/**
 * Present a bundle to a consumer, or say why it cannot be presented.
 *
 * A bundle that fails validation becomes `unavailable` carrying the problems —
 * never `observed` with the offending deltas dropped. Silently rendering the
 * survivors of a failed validation is how a partial artifact becomes a
 * confident one.
 */
export function toComparisonState(bundle: unknown, whenNull: string): PlanComparisonState {
  if (bundle === null || bundle === undefined) return { status: "unavailable", reason: whenNull };
  const problems = validateBundle(bundle);
  if (problems.length > 0) {
    return {
      status: "unavailable",
      reason: `the plan comparison did not validate against its event: ${problems.join("; ")}`,
    };
  }
  return { status: "observed", comparison: (bundle as JudgeRunBundle).comparison };
}
