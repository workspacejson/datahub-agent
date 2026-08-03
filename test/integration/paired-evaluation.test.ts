import { describe, expect, it } from "vitest";

import {
  aggregatePairs,
  buildPairRecord,
  compareWithinPair,
  invocationOrderFor,
  observePlan,
  parsePlanResponse,
  type ConditionOutcome,
  type PlanStepRecord,
} from "../../src/integration/paired-evaluation.js";
import type { RunIdentity } from "../../src/integration/plan-comparison.js";

const SOURCE = "dbt/models/curated/game_events.sql";
const REVISION = "59fa295c51fc23466f3a71542f8bf3d1335daa83";

const RUN: RunIdentity = {
  taskId: "add-quality-check",
  promptDigest: "sha256:prompt",
  model: "qwen-plus",
  settingsDigest: "sha256:settings",
};

const refusalSteps: PlanStepRecord[] = [
  { id: "refuse-unknown-source", action: "refuse to add the dbt quality check because the repository-relative source location is unknown" },
];
const joinedSteps: PlanStepRecord[] = [
  { id: "add-check", action: `Add a dbt quality check using repository-relative source "${SOURCE}" and pinned revision "${REVISION}"` },
];

const observed = (mode: "datahub-only" | "joined", steps: PlanStepRecord[]): ConditionOutcome => ({
  state: "observed",
  observation: observePlan(mode, steps),
});

const conformingPair = (index: number) =>
  buildPairRecord(`pair-${index}`, index, observed("datahub-only", refusalSteps), observed("joined", joinedSteps), SOURCE, REVISION);

describe("observation normalises the fields the six measures need", () => {
  it("extracts paths and revisions without fusing tokens across steps", () => {
    const o = observePlan("joined", [
      { id: "a", action: `edit ${SOURCE}` },
      { id: "b", action: `at ${REVISION}` },
    ]);
    expect(o.filesReferenced).toEqual([SOURCE]);
    expect(o.revisionsReferenced).toEqual([REVISION.toLowerCase()]);
    expect(o.stepIds).toEqual(["a", "b"]);
  });

  it("detects refusal and uncertainty with the runner's own vocabulary", () => {
    const o = observePlan("datahub-only", refusalSteps);
    expect(o.refusalPresent).toBe(true);
    expect(o.uncertaintyPresent).toBe(true);
    expect(observePlan("joined", joinedSteps).refusalPresent).toBe(false);
  });

  it("does not mistake a bare word for a revision", () => {
    expect(observePlan("joined", [{ id: "a", action: "deadbeef is not a word but abcdefg is too short" }]).revisionsReferenced)
      .toEqual(["deadbeef"]);
  });
});

describe("malformed output is recorded, never thrown and never dropped", () => {
  it("records a non-object response as unparsable", () => {
    const outcome = parsePlanResponse("joined", "not json");
    expect(outcome.state).toBe("failed");
    if (outcome.state === "failed") expect(outcome.failure.kind).toBe("unparsable");
  });

  it("records a missing steps array as unparsable", () => {
    const outcome = parsePlanResponse("joined", { notSteps: [] });
    expect(outcome.state).toBe("failed");
  });

  it("records a malformed step and names its index", () => {
    const outcome = parsePlanResponse("joined", { steps: [{ id: "a", action: "ok" }, { id: 7 }] });
    expect(outcome.state).toBe("failed");
    if (outcome.state === "failed" && outcome.failure.kind === "unparsable") {
      expect(outcome.failure.detail).toContain("step 1");
    }
  });

  it("never throws on any of the shapes a model can return", () => {
    for (const raw of [null, undefined, 0, "", [], {}, { steps: null }, { steps: [null] }]) {
      expect(() => parsePlanResponse("joined", raw)).not.toThrow();
    }
  });
});

describe("within-pair comparison", () => {
  it("reports the exact source and revision as joined-only when they are", () => {
    const c = compareWithinPair(observePlan("datahub-only", refusalSteps), observePlan("joined", joinedSteps), SOURCE, REVISION);
    expect(c.exactSourceOnlyInJoined).toBe(true);
    expect(c.exactRevisionOnlyInJoined).toBe(true);
    expect(c.refusalRemovedByJoin).toBe(true);
    expect(c.filesAddedByJoin).toEqual([SOURCE]);
  });

  /*
    The detector, against a constructed non-conforming run. Every assertion
    above passes trivially on an instrument that always returns true, and a
    measurement whose negative case is untested reports its own optimism. This
    is the run `paired-plan-runner` would have thrown on, and the shape that
    must survive to reach the denominator.
  */
  it("reports a joined plan that omits the revision as NOT joined-only", () => {
    const withoutRevision = [{ id: "add-check", action: `Add a dbt quality check using ${SOURCE}` }];
    const c = compareWithinPair(observePlan("datahub-only", refusalSteps), observePlan("joined", withoutRevision), SOURCE, REVISION);
    expect(c.exactSourceOnlyInJoined).toBe(true);
    expect(c.exactRevisionOnlyInJoined).toBe(false);
  });

  it("reports a datahub-only plan that leaked the source as NOT joined-only", () => {
    const leaked = [{ id: "guess", action: `refuse, though the file is probably ${SOURCE}` }];
    const c = compareWithinPair(observePlan("datahub-only", leaked), observePlan("joined", joinedSteps), SOURCE, REVISION);
    expect(c.exactSourceOnlyInJoined).toBe(false);
  });

  it("compares sequencing on step ids, so rewording is not a reorder", () => {
    const reworded = [{ id: "refuse-unknown-source", action: "decline: the source location cannot be established" }];
    expect(compareWithinPair(observePlan("datahub-only", refusalSteps), observePlan("joined", reworded), SOURCE, REVISION).sequencingChanged)
      .toBe(false);
  });
});

describe("within-pair invocation order is counterbalanced and recorded", () => {
  it("alternates which condition leads, by pair index", () => {
    expect(invocationOrderFor(0)).toEqual(["datahub-only", "joined"]);
    expect(invocationOrderFor(1)).toEqual(["joined", "datahub-only"]);
    expect(invocationOrderFor(2)).toEqual(["datahub-only", "joined"]);
  });

  it("splits ten pairs evenly between the two lead positions", () => {
    const leads = Array.from({ length: 10 }, (_, i) => invocationOrderFor(i)[0]);
    expect(leads.filter((m) => m === "datahub-only")).toHaveLength(5);
    expect(leads.filter((m) => m === "joined")).toHaveLength(5);
  });

  it("records the order it used on every pair record", () => {
    expect(conformingPair(0).invocationOrder).toEqual(["datahub-only", "joined"]);
    expect(conformingPair(1).invocationOrder).toEqual(["joined", "datahub-only"]);
  });

  it("reports the headline measure split by lead position, against assigned arms", () => {
    const records = Array.from({ length: 10 }, (_, i) => conformingPair(i));
    const aggregate = aggregatePairs(records, RUN, 10);
    expect(aggregate.orderEffect.datahubOnlyFirst.assigned).toBe(5);
    expect(aggregate.orderEffect.joinedFirst.assigned).toBe(5);
    expect(aggregate.orderEffect.datahubOnlyFirst.exactRevisionOnlyInJoined).toEqual({ count: 5, denominator: 5 });
    expect(aggregate.orderEffect.joinedFirst.exactRevisionOnlyInJoined).toEqual({ count: 5, denominator: 5 });
  });

  /*
    The detector for the order split. If a position effect were present, the two
    arms must not read identically -- a split that always matches would make the
    counterbalancing decorative.
  */
  it("shows an asymmetric split when the lead position actually matters", () => {
    const noRevision = [{ id: "add-check", action: `Add a dbt quality check using ${SOURCE}` }];
    const records = Array.from({ length: 10 }, (_, i) =>
      buildPairRecord(
        `pair-${i}`,
        i,
        observed("datahub-only", refusalSteps),
        // Joined omits the revision whenever it was invoked first.
        observed("joined", invocationOrderFor(i)[0] === "joined" ? noRevision : joinedSteps),
        SOURCE,
        REVISION,
      ),
    );
    const aggregate = aggregatePairs(records, RUN, 10);
    expect(aggregate.orderEffect.datahubOnlyFirst.exactRevisionOnlyInJoined.count).toBe(5);
    expect(aggregate.orderEffect.joinedFirst.exactRevisionOnlyInJoined.count).toBe(0);
  });
});

describe("aggregation keeps the requested denominator", () => {
  it("counts against pairs requested, not pairs that conformed", () => {
    const records = [
      conformingPair(0),
      conformingPair(1),
      buildPairRecord("pair-2", 2, observed("datahub-only", refusalSteps), parsePlanResponse("joined", "garbage"), SOURCE, REVISION),
    ];
    const aggregate = aggregatePairs(records, RUN, 10);

    expect(aggregate.pairsRequested).toBe(10);
    expect(aggregate.pairsObserved).toBe(2);
    expect(aggregate.pairsPartial).toBe(1);
    // The measure saw two conforming comparisons, but the denominator is the
    // experiment's size. 2/10, never 2/2 and never 2/3.
    expect(aggregate.measures.exactRevisionOnlyInJoined).toEqual({ count: 2, denominator: 10 });
  });

  it("enumerates every failure rather than counting them", () => {
    const records = [
      buildPairRecord("pair-0", 0, parsePlanResponse("datahub-only", "bad"), observed("joined", joinedSteps), SOURCE, REVISION),
      buildPairRecord("pair-1", 1, observed("datahub-only", refusalSteps), parsePlanResponse("joined", { steps: "no" }), SOURCE, REVISION),
    ];
    const aggregate = aggregatePairs(records, RUN, 2);
    expect(aggregate.failures).toHaveLength(2);
    expect(aggregate.failures.map((f) => f.condition).sort()).toEqual(["datahub-only", "joined"]);
    expect(aggregate.failures.every((f) => f.failure.kind === "unparsable")).toBe(true);
  });

  it("produces no composite score", () => {
    const aggregate = aggregatePairs([conformingPair(0)], RUN, 1);
    const keys = Object.keys(aggregate.measures);
    expect(keys).not.toContain("score");
    for (const value of Object.values(aggregate.measures)) {
      expect(value).toHaveProperty("denominator");
    }
  });

  it("characterises run-to-run stability per condition", () => {
    const varied = [{ id: "other-id", action: `Add a check using ${SOURCE} at ${REVISION}` }];
    const records = [
      conformingPair(0),
      buildPairRecord("pair-1", 1, observed("datahub-only", refusalSteps), observed("joined", varied), SOURCE, REVISION),
    ];
    const aggregate = aggregatePairs(records, RUN, 2);
    expect(aggregate.stability.joined.distinctSequences).toBe(2);
    expect(aggregate.stability.datahubOnly.distinctSequences).toBe(1);
    expect(aggregate.stability.datahubOnly.refusalPresent).toEqual({ count: 2, denominator: 2 });
  });

  it("reports zero observed pairs without dividing by zero or inventing a rate", () => {
    const records = [
      buildPairRecord("pair-0", 0, parsePlanResponse("datahub-only", "x"), parsePlanResponse("joined", "y"), SOURCE, REVISION),
    ];
    const aggregate = aggregatePairs(records, RUN, 10);
    expect(aggregate.pairsObserved).toBe(0);
    expect(aggregate.pairsFailed).toBe(1);
    expect(aggregate.measures.exactRevisionOnlyInJoined).toEqual({ count: 0, denominator: 10 });
  });
});
