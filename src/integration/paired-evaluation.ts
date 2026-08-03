/**
 * HAC-150 repeated paired evaluation: the measurement instrument.
 *
 * `paired-plan-runner.ts` produces one judge-facing bundle and fails closed:
 * `assertConditionOutputs` throws when the DataHub-only plan does not refuse or
 * the joined plan omits the exact source, and `deriveDeltas` throws when no
 * semantic delta is found. That is right for an exemplar. A single bundle shown
 * to a judge must be valid, and a runner that emitted an invalid one would be
 * publishing a claim it could not support.
 *
 * It is wrong for a measurement. An instrument that throws on every
 * non-conforming outcome records only confirming ones, so ten invocations that
 * produce seven conforming runs yield seven artifacts and a 7/7 result. The
 * denominator is silently rewritten by the instrument, which is the defect
 * HAC-150 exists to prevent, scaled from one run to ten.
 *
 * So observation is separated from assertion. Nothing here throws on model
 * content. Every invocation lands in exactly one terminal state, the raw
 * response is retained verbatim, and the denominator is always the number of
 * pairs *requested* rather than the number that happened to conform.
 */

import { toDataHubOnly, type ChangeImpactEvent } from "./change-impact-event.js";
import type { PlanMode, RunIdentity } from "./plan-comparison.js";

export const PAIRED_EVALUATION_VERSION = "1.0" as const;

/**
 * Refusal and uncertainty vocabulary, kept identical to `paired-plan-runner`'s
 * `assertConditionOutputs`.
 *
 * Two detectors reading the same model output must agree on what a refusal is.
 * If the runner's exemplar counts as a refusal and this instrument's does not,
 * the published evaluation would contradict the bundle shipped beside it, and a
 * judge comparing them would be right to distrust both.
 */
const REFUSAL = /\b(refuse|cannot|can't|do not)\b/;
const UNCERTAINTY = /\b(unknown|not established|not known|unavailable)\b/;

/** A 40-hex git revision, or an abbreviation of at least 8. Bare words never match. */
const REVISION_TOKEN = /\b[0-9a-f]{8,40}\b/g;

/** A path-like token: at least one separator and a file extension. */
const PATH_TOKEN = /\b[\w.-]+(?:\/[\w.-]+)+\.[a-z]{1,6}\b/g;

export interface PlanStepRecord {
  id: string;
  action: string;
}

/**
 * One condition's output, normalised into the fields the six measures need.
 *
 * The normalised fields sit beside `steps` rather than replacing them. HAC-150
 * asks for comparison of semantic fields rather than raw prose, but discarding
 * the prose would make every aggregate unauditable: a reviewer disputing
 * `exactRevisionPresent` needs the text the flag was derived from, in the same
 * record, without re-running anything.
 */
export interface PlanObservation {
  mode: PlanMode;
  steps: PlanStepRecord[];
  stepCount: number;
  /** Step ids in emitted order. Sequencing is compared on this, not on prose. */
  stepIds: string[];
  /** Distinct path-like tokens, in first-seen order. */
  filesReferenced: string[];
  /** Distinct revision-like tokens, lowercased, in first-seen order. */
  revisionsReferenced: string[];
  refusalPresent: boolean;
  uncertaintyPresent: boolean;
  /** Whether any step mentions writing back to the catalog. */
  writebackMentioned: boolean;
}

/** Why a condition produced no observation. Never silently dropped. */
export type ConditionFailure =
  | { kind: "transport"; detail: string }
  | { kind: "unparsable"; detail: string; raw: string };

export type ConditionOutcome =
  | { state: "observed"; observation: PlanObservation }
  | { state: "failed"; failure: ConditionFailure };

/**
 * The within-pair comparison, computed only when both conditions were observed.
 *
 * `null` when either side failed. A pair with one missing half cannot report
 * "files added by the join" without inventing the missing baseline, and
 * reporting zero would be indistinguishable from a real zero.
 */
export interface WithinPairComparison {
  filesAddedByJoin: string[];
  filesRemovedByJoin: string[];
  sequencingChanged: boolean;
  refusalRemovedByJoin: boolean;
  exactSourceOnlyInJoined: boolean;
  exactRevisionOnlyInJoined: boolean;
  writebackChoiceChanged: boolean;
}

export interface PairRecord {
  /** Shared across both conditions of one pair. Stable and reproducible. */
  pairId: string;
  index: number;
  /**
   * The order the two conditions were actually invoked in, for this pair.
   *
   * Recorded rather than assumed. Each invocation is a stateless completion, so
   * a first-mover effect should not exist — but "should not" is a prediction,
   * and an experiment that always invokes DataHub-only first cannot distinguish
   * a condition effect from a position effect if one turns out to be present.
   * Provider-side caching, adaptive routing and throttling drift within a pair
   * are all position-shaped.
   */
  invocationOrder: [PlanMode, PlanMode];
  datahubOnly: ConditionOutcome;
  joined: ConditionOutcome;
  /** `observed` only when both conditions were observed. */
  outcome: "observed" | "partial" | "failed";
  comparison: WithinPairComparison | null;
}

/**
 * Deterministic counterbalancing: even pairs lead with DataHub-only, odd pairs
 * lead with joined.
 *
 * Deterministic rather than randomised, because the experiment must be exactly
 * reproducible from the manifest — a random order would need a seed recorded
 * and replayed, which is more machinery for the same guarantee. Over ten pairs
 * this puts each condition in first position five times, so a position effect
 * would show as a split between even and odd pairs rather than hiding inside
 * the condition difference.
 */
export function invocationOrderFor(index: number): [PlanMode, PlanMode] {
  return index % 2 === 0 ? ["datahub-only", "joined"] : ["joined", "datahub-only"];
}

const distinct = (values: string[]): string[] => [...new Set(values)];

const matchAll = (text: string, pattern: RegExp): string[] =>
  distinct([...text.matchAll(pattern)].map((match) => match[0]));

/**
 * Normalise one model response into an observation.
 *
 * Actions are joined with a newline rather than concatenated, so a path ending
 * one step and a revision opening the next cannot fuse into a token that
 * appears in neither.
 */
export function observePlan(mode: PlanMode, steps: PlanStepRecord[]): PlanObservation {
  const normalisedSteps = steps.map((step) => ({ id: step.id.trim(), action: step.action.trim() }));
  const text = normalisedSteps.map((step) => step.action).join("\n");
  const lower = text.toLowerCase();
  return {
    mode,
    steps: normalisedSteps,
    stepCount: normalisedSteps.length,
    stepIds: normalisedSteps.map((step) => step.id),
    filesReferenced: matchAll(text, PATH_TOKEN),
    revisionsReferenced: matchAll(lower, REVISION_TOKEN),
    refusalPresent: REFUSAL.test(lower),
    uncertaintyPresent: UNCERTAINTY.test(lower),
    writebackMentioned: /\b(writeback|write back|enrich|structured propert|catalog update)\w*\b/.test(lower),
  };
}

/**
 * Parse a model response without throwing.
 *
 * The runner's `invoke` rejects on malformed JSON, which is correct there. Here
 * a malformed response is a recorded outcome: it is evidence about the model's
 * run-to-run stability, and discarding it would improve the reported stability
 * by deleting the instability.
 */
export function parsePlanResponse(mode: PlanMode, raw: unknown): ConditionOutcome {
  const asText = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (raw === null || typeof raw !== "object") {
    return { state: "failed", failure: { kind: "unparsable", detail: "response was not a JSON object", raw: String(asText).slice(0, 2000) } };
  }
  const steps = (raw as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) {
    return { state: "failed", failure: { kind: "unparsable", detail: "response carried no `steps` array", raw: String(asText).slice(0, 2000) } };
  }
  const malformed = steps.findIndex(
    (step) => !step || typeof (step as PlanStepRecord).id !== "string" || typeof (step as PlanStepRecord).action !== "string",
  );
  if (malformed !== -1) {
    return {
      state: "failed",
      failure: { kind: "unparsable", detail: `step ${malformed} lacked string id/action`, raw: String(asText).slice(0, 2000) },
    };
  }
  return { state: "observed", observation: observePlan(mode, steps as PlanStepRecord[]) };
}

/** Sequencing is compared on step ids in order, so rewording a step is not a reorder. */
const sameSequence = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => id === b[index]);

export function compareWithinPair(
  datahubOnly: PlanObservation,
  joined: PlanObservation,
  exactSource: string,
  exactRevision: string,
): WithinPairComparison {
  const source = exactSource.toLowerCase();
  const revision = exactRevision.toLowerCase();
  const inDatahub = new Set(datahubOnly.filesReferenced.map((f) => f.toLowerCase()));
  const inJoined = new Set(joined.filesReferenced.map((f) => f.toLowerCase()));
  const datahubText = datahubOnly.steps.map((s) => s.action).join("\n").toLowerCase();
  const joinedText = joined.steps.map((s) => s.action).join("\n").toLowerCase();
  return {
    filesAddedByJoin: joined.filesReferenced.filter((f) => !inDatahub.has(f.toLowerCase())),
    filesRemovedByJoin: datahubOnly.filesReferenced.filter((f) => !inJoined.has(f.toLowerCase())),
    sequencingChanged: !sameSequence(datahubOnly.stepIds, joined.stepIds),
    refusalRemovedByJoin: datahubOnly.refusalPresent && !joined.refusalPresent,
    exactSourceOnlyInJoined: joinedText.includes(source) && !datahubText.includes(source),
    exactRevisionOnlyInJoined: joinedText.includes(revision) && !datahubText.includes(revision),
    writebackChoiceChanged: datahubOnly.writebackMentioned !== joined.writebackMentioned,
  };
}

export function buildPairRecord(
  pairId: string,
  index: number,
  datahubOnly: ConditionOutcome,
  joined: ConditionOutcome,
  exactSource: string,
  exactRevision: string,
  invocationOrder: [PlanMode, PlanMode] = invocationOrderFor(index),
): PairRecord {
  const bothObserved = datahubOnly.state === "observed" && joined.state === "observed";
  const neitherObserved = datahubOnly.state === "failed" && joined.state === "failed";
  return {
    pairId,
    index,
    invocationOrder,
    datahubOnly,
    joined,
    outcome: bothObserved ? "observed" : neitherObserved ? "failed" : "partial",
    comparison:
      datahubOnly.state === "observed" && joined.state === "observed"
        ? compareWithinPair(datahubOnly.observation, joined.observation, exactSource, exactRevision)
        : null,
  };
}

/** A count and the denominator it was measured against. Never a bare number. */
export interface Measured {
  count: number;
  /** Always the pairs requested, never the pairs that conformed. */
  denominator: number;
}

export interface ConditionStability {
  /** Distinct step-id sequences seen across observed runs of this condition. */
  distinctSequences: number;
  /** Distinct step counts seen. */
  distinctStepCounts: number;
  /** Runs of this condition that produced an observation. */
  observed: Measured;
  refusalPresent: Measured;
}

export interface PairedEvaluationAggregate {
  evaluationVersion: typeof PAIRED_EVALUATION_VERSION;
  run: RunIdentity;
  pairsRequested: number;
  pairsObserved: number;
  pairsPartial: number;
  pairsFailed: number;
  /** Every failure, with the condition it came from. Enumerated, not counted. */
  failures: Array<{ pairId: string; index: number; condition: PlanMode; failure: ConditionFailure }>;
  measures: {
    exactSourceOnlyInJoined: Measured;
    exactRevisionOnlyInJoined: Measured;
    refusalRemovedByJoin: Measured;
    sequencingChanged: Measured;
    writebackChoiceChanged: Measured;
    anyFileAddedByJoin: Measured;
    anyFileRemovedByJoin: Measured;
  };
  stability: { datahubOnly: ConditionStability; joined: ConditionStability };
  /**
   * The headline measure split by which condition was invoked first.
   *
   * Counterbalancing removes the confound; this is what reports whether one was
   * present. Denominators are the pairs *assigned* to each arm, which is fixed
   * by `invocationOrderFor` before any run happens and so cannot be rewritten
   * by the outcome. A split that differs sharply between arms means position
   * mattered, and the headline sentence must not be written as if it did not.
   */
  orderEffect: {
    datahubOnlyFirst: { assigned: number; exactRevisionOnlyInJoined: Measured };
    joinedFirst: { assigned: number; exactRevisionOnlyInJoined: Measured };
  };
}

const conditionStability = (records: PairRecord[], mode: PlanMode, denominator: number): ConditionStability => {
  const outcomes = records.map((record) => (mode === "joined" ? record.joined : record.datahubOnly));
  const observed = outcomes.flatMap((outcome) => (outcome.state === "observed" ? [outcome.observation] : []));
  return {
    distinctSequences: new Set(observed.map((o) => o.stepIds.join(" "))).size,
    distinctStepCounts: new Set(observed.map((o) => o.stepCount)).size,
    observed: { count: observed.length, denominator },
    refusalPresent: { count: observed.filter((o) => o.refusalPresent).length, denominator },
  };
};

/**
 * Aggregate the pair records.
 *
 * Every denominator is `pairsRequested`. A measure counted against the observed
 * subset would read as a rate the experiment never achieved: nine conforming
 * runs out of ten attempts is 9/10, and reporting 9/9 would describe a
 * different, better experiment than the one that ran.
 *
 * No composite score is produced. The six measures answer different questions,
 * and a single number combining them would be unfalsifiable — a judge could not
 * tell which measure moved it, which is the property a summary statistic must
 * not have on an evidence surface.
 */
export function aggregatePairs(records: PairRecord[], run: RunIdentity, pairsRequested: number): PairedEvaluationAggregate {
  const denominator = pairsRequested;
  const comparisons = records.flatMap((record) => (record.comparison ? [record.comparison] : []));
  const measured = (predicate: (c: WithinPairComparison) => boolean): Measured => ({
    count: comparisons.filter(predicate).length,
    denominator,
  });
  const failures: PairedEvaluationAggregate["failures"] = [];
  for (const record of records) {
    if (record.datahubOnly.state === "failed") {
      failures.push({ pairId: record.pairId, index: record.index, condition: "datahub-only", failure: record.datahubOnly.failure });
    }
    if (record.joined.state === "failed") {
      failures.push({ pairId: record.pairId, index: record.index, condition: "joined", failure: record.joined.failure });
    }
  }
  return {
    evaluationVersion: PAIRED_EVALUATION_VERSION,
    run,
    pairsRequested,
    pairsObserved: records.filter((r) => r.outcome === "observed").length,
    pairsPartial: records.filter((r) => r.outcome === "partial").length,
    pairsFailed: records.filter((r) => r.outcome === "failed").length,
    failures,
    measures: {
      exactSourceOnlyInJoined: measured((c) => c.exactSourceOnlyInJoined),
      exactRevisionOnlyInJoined: measured((c) => c.exactRevisionOnlyInJoined),
      refusalRemovedByJoin: measured((c) => c.refusalRemovedByJoin),
      sequencingChanged: measured((c) => c.sequencingChanged),
      writebackChoiceChanged: measured((c) => c.writebackChoiceChanged),
      anyFileAddedByJoin: measured((c) => c.filesAddedByJoin.length > 0),
      anyFileRemovedByJoin: measured((c) => c.filesRemovedByJoin.length > 0),
    },
    stability: {
      datahubOnly: conditionStability(records, "datahub-only", denominator),
      joined: conditionStability(records, "joined", denominator),
    },
    orderEffect: (() => {
      // Assignment comes from the index, not from what the run returned, so
      // both arms are sized before any invocation happens.
      const arm = (leader: PlanMode) => {
        const assigned = Array.from({ length: pairsRequested }, (_, i) => invocationOrderFor(i)[0]).filter((m) => m === leader).length;
        const inArm = records.filter((r) => r.invocationOrder[0] === leader);
        return {
          assigned,
          exactRevisionOnlyInJoined: {
            count: inArm.filter((r) => r.comparison?.exactRevisionOnlyInJoined).length,
            denominator: assigned,
          },
        };
      };
      return { datahubOnlyFirst: arm("datahub-only"), joinedFirst: arm("joined") };
    })(),
  };
}

/**
 * The two conditions' contexts, from one event.
 *
 * Re-exported through this module so the evaluation harness and the judge-bundle
 * runner derive the DataHub-only projection from one function. Two derivations
 * would let the measured condition drift from the shipped one.
 */
export function conditionContexts(event: ChangeImpactEvent): { datahubOnly: ChangeImpactEvent; joined: ChangeImpactEvent } {
  return { datahubOnly: toDataHubOnly(event), joined: event };
}
