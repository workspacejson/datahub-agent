/**
 * The frozen vocabulary, held in place by the violations it must refuse.
 *
 * HAC-146 renamed three things: `EvidenceRecord.verified` to `checkExecuted`,
 * the writeback receipt's `verified` to `bothStatesRead`, and completeness from
 * `verified | unverified` to `complete-against-pinned-manifest | not-established`.
 *
 * A rename that only changes spelling is worth very little. Each of these words
 * was doing work the old one let a caller skip, so every test here authors the
 * violation the new word exists to prevent and asserts it is refused. A test
 * that cannot fail is not a criterion — the point is not that the vocabulary
 * compiles, it is that the vocabulary is enforced.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CHANGE_IMPACT_EVENT_VERSION,
  describeTier,
  validateEvent,
  type ChangeImpactEvent,
  type EvidenceRecord,
} from "../../src/integration/change-impact-event.js";
import {
  deriveOutcome,
  notQueriedState,
  unreadableState,
  type CatalogState,
  type WritebackIntent,
} from "../../src/integration/writeback.js";

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/golden");
const GOLDEN = ["change-impact-event.root.json", "change-impact-event.nested.json"];

/** A minimal valid event. Each test breaks exactly one thing from here. */
function validEvent(): ChangeImpactEvent {
  return {
    eventVersion: CHANGE_IMPACT_EVENT_VERSION,
    provenance: {
      producedAt: "2026-07-28T00:00:00.000Z",
      producer: { name: "@workspacejson/datahub-agent", version: "0.0.1" },
      datahub: { gmsUrl: "http://localhost:8080", gmsVersion: "v1.5.0.6" },
      corpus: { repository: "https://github.com/example/repo", commit: "a".repeat(40) },
      workspaceArtifact: {
        producedBy: "@workspacejson/cli",
        fileIndexKeys: 12,
        repository: "https://github.com/example/repo",
        revision: "a".repeat(40),
        integrity: "exact-match",
      },
    },
    subject: { urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,db.schema.model,PROD)" },
    datahub: {
      name: "model",
      platform: "dbt",
      description: null,
      upstreams: [{ urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,db.schema.up,PROD)", name: "up", degree: 1 }],
      downstreams: [{ urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,db.schema.down,PROD)", name: "down", degree: 1 }],
      lineageObservation: {
        upstreams: { read: "ok", completeness: "not-established", observedCount: 1 },
        downstreams: { read: "ok", completeness: "not-established", observedCount: 1 },
      },
      schemaFieldCount: 4,
      owners: [],
      domain: null,
    },
    code: {
      dbtUniqueId: "model.proj.model",
      dbtFilePath: "models/model.sql",
      repositoryRelativePath: "dbt/models/model.sql",
      projectPrefix: "dbt",
      method: "manifest-join",
      sourceUrl: null,
    },
    partners: [
      { repositoryRelativePath: "dbt/models/other.sql", reason: "changes alongside", source: "workspacejson" },
    ],
    evidence: {
      records: [{ claim: "tracked", observation: "key present", source: "workspacejson", checkExecuted: true }],
      tier: "VERIFIED",
    },
    accounting: {
      datasetsRequested: 1,
      datasetsResolved: 1,
      datasetsUnresolved: 0,
      nodesDropped: 0,
      nodesExcluded: {},
    },
    unavailable: [],
  };
}

describe("V-1 · completeness without the manifest it names", () => {
  // `complete-against-pinned-manifest` is the only completeness value that makes
  // a positive claim, and it names the thing it was checked against. Allowing it
  // without `VerificationEvidence` would make the second axis exactly what it
  // was introduced to replace: a place to assert a word.

  it("refuses the claim on a lineage direction with no evidence block", () => {
    const event = validEvent();
    event.datahub.lineageObservation.upstreams = {
      read: "ok",
      completeness: "complete-against-pinned-manifest",
      observedCount: 1,
    };
    expect(validateEvent(event)).toContainEqual(
      expect.stringContaining("claims complete-against-pinned-manifest without naming the manifest"),
    );
  });

  it.each(["manifestDigest", "expectedSetDigest", "observedSetDigest"] as const)(
    "refuses the claim when the evidence block omits %s",
    (field) => {
      const event = validEvent();
      const verification = {
        manifestDigest: "m",
        expectedSetDigest: "e",
        observedSetDigest: "o",
        queryParameters: { direction: "UPSTREAM" },
      };
      verification[field] = "";
      event.datahub.lineageObservation.upstreams = {
        read: "ok",
        completeness: "complete-against-pinned-manifest",
        observedCount: 1,
        verification,
      };
      expect(validateEvent(event)).toContainEqual(expect.stringContaining(field));
    },
  );

  it("refuses the claim when the query parameters are empty, since two sets are only comparable under the same ones", () => {
    const event = validEvent();
    event.datahub.lineageObservation.upstreams = {
      read: "ok",
      completeness: "complete-against-pinned-manifest",
      observedCount: 1,
      verification: {
        manifestDigest: "m",
        expectedSetDigest: "e",
        observedSetDigest: "o",
        queryParameters: {},
      },
    };
    expect(validateEvent(event)).toContainEqual(
      expect.stringContaining("without naming the manifest (queryParameters)"),
    );
  });

  it("refuses the claim on a read that never happened", () => {
    // The strongest completeness claim resting on no read at all.
    const event = validEvent();
    event.datahub.upstreams = [];
    event.datahub.lineageObservation.upstreams = {
      read: "not-queried",
      completeness: "complete-against-pinned-manifest",
    };
    event.unavailable = [{
      field: "datahub.upstreams",
      source: "datahub",
      reason: "not-queried",
      detail: "no lineage query was issued",
    }];
    expect(validateEvent(event)).toContainEqual(
      expect.stringContaining("complete-against-pinned-manifest on a read that did not happen"),
    );
  });

  it("accepts the claim when the manifest is actually named — so the gate is not simply always-refuse", () => {
    const event = validEvent();
    event.datahub.lineageObservation.upstreams = {
      read: "ok",
      completeness: "complete-against-pinned-manifest",
      observedCount: 1,
      verification: {
        manifestDigest: "m",
        expectedSetDigest: "e",
        observedSetDigest: "o",
        queryParameters: { direction: "UPSTREAM", degree: 1 },
      },
    };
    expect(validateEvent(event)).toEqual([]);
  });
});

describe("V-2 · evidence claiming a check that did not execute", () => {
  const record = (checkExecuted: boolean): EvidenceRecord => ({
    claim: "c",
    observation: "o",
    source: "workspacejson",
    checkExecuted,
  });

  it("refuses tier VERIFIED when no record carries an executed check", () => {
    // The tier is a mechanical function of the records. Asserting the tier
    // directly is how a producer would claim a check it never ran.
    const event = validEvent();
    event.evidence = { records: [record(false), record(false)], tier: "VERIFIED" };
    expect(validateEvent(event)).toContainEqual(
      "evidence.tier is not the mechanical function of evidence.records",
    );
  });

  it("refuses tier OBSERVED when a record does carry one, so the rule binds in both directions", () => {
    const event = validEvent();
    event.evidence = { records: [record(true)], tier: "OBSERVED" };
    expect(validateEvent(event)).toContainEqual(
      "evidence.tier is not the mechanical function of evidence.records",
    );
  });

  it("refuses a checkExecuted workspacejson record when the artifact was refused", () => {
    // A check that ran against an artifact describing a different repository
    // established nothing about this subject. This is HAC-225's defect, held
    // under the new field name.
    const event = validEvent();
    event.provenance.workspaceArtifact!.integrity = "repository-mismatch";
    expect(validateEvent(event)).toContainEqual(
      expect.stringContaining("record(s) marked checkExecuted"),
    );
  });
});

describe("V-3 · a receipt whose bothStatesRead contradicts its reads", () => {
  const intent: WritebackIntent = { linkUrl: null, evidenceTier: "VERIFIED" };
  const ok = (): CatalogState => ({
    linkUrl: null,
    evidenceTier: "VERIFIED",
    read: "ok",
    readError: null,
  });

  // The contradiction is unauthorable through the sanctioned path rather than
  // merely detected after the fact — which is the stronger guarantee, and the
  // reason the verdict lives in `deriveOutcome` instead of in the CLI.
  it.each([
    ["both read", ok(), ok(), true],
    ["before unreadable", unreadableState("boom"), ok(), false],
    ["after unreadable", ok(), unreadableState("boom"), false],
    ["neither read", notQueriedState("dry run"), notQueriedState("dry run"), false],
  ])("derives bothStatesRead from the reads alone: %s", (_label, before, after, expected) => {
    const outcome = deriveOutcome({
      refusedBecause: null,
      intent,
      before: before as CatalogState,
      after: after as CatalogState,
      attempts: [{ mutation: "upsertStructuredProperties", variables: {}, succeeded: true, response: "ok" }],
    });
    expect(outcome.bothStatesRead).toBe(expected);
  });

  it("keeps bothStatesRead true on a refusal that still read both states, rather than collapsing it into the verdict", () => {
    // The pair that looked self-contradictory under the old name and is not:
    // both states were read, and the writeback was refused. `verified: true`
    // beside `succeeded: false` invited a reader to assume one was wrong.
    const outcome = deriveOutcome({
      refusedBecause: "the producing file could not be resolved",
      intent: null,
      before: ok(),
      after: ok(),
      attempts: [],
    });
    expect(outcome).toEqual({ succeeded: false, noop: false, bothStatesRead: true });
  });

  it("never reports success on an after-state it could not read", () => {
    const outcome = deriveOutcome({
      refusedBecause: null,
      intent,
      before: ok(),
      after: unreadableState("connection reset"),
      attempts: [{ mutation: "upsertStructuredProperties", variables: {}, succeeded: true, response: "ok" }],
    });
    expect(outcome.succeeded).toBe(false);
    expect(outcome.bothStatesRead).toBe(false);
  });
});

describe("V-4 · a naked tier token reaching a reader", () => {
  const records = (n: number, executed: number): EvidenceRecord[] =>
    Array.from({ length: n }, (_, i) => ({
      claim: `c${i}`,
      observation: `o${i}`,
      source: "datahub" as const,
      checkExecuted: i < executed,
    }));

  it("never returns a bare tier token, in any tier", () => {
    // `VERIFIED` alone is a fact about records that reads as a warrant about
    // claims. Every sanctioned rendering carries what produced it.
    for (const phrase of [describeTier([]), describeTier(records(2, 0)), describeTier(records(3, 1))]) {
      expect(phrase).toMatch(/^(ASSERTED|OBSERVED|VERIFIED) — /);
      expect(phrase).not.toMatch(/^(ASSERTED|OBSERVED|VERIFIED)$/);
    }
  });

  it("states how many records carry an executed check, so the tier can be checked against them", () => {
    expect(describeTier(records(3, 1))).toBe(
      "VERIFIED — 1 of 3 record(s) carry a check this harness executed",
    );
    expect(describeTier(records(2, 0))).toBe(
      "OBSERVED — 2 record(s), none of them a check this harness executed",
    );
    expect(describeTier([])).toBe("ASSERTED — no supporting record was captured");
  });
});

describe("V-5 · a committed fixture left on stale vocabulary", () => {
  const SUPERSEDED = [
    // The exact spellings HAC-146 retired. A fixture regenerated before the
    // rename would carry these and would otherwise sit in the repository
    // looking current, on the surface a judge is invited to inspect.
    '"verified"',
    '"unverified"',
    '"verified":',
    '"completeness": "verified"',
    '"completeness": "unverified"',
  ];

  it.each(GOLDEN)("%s carries no superseded vocabulary", (name) => {
    const raw = readFileSync(join(goldenDir, name), "utf8");
    for (const token of SUPERSEDED) {
      expect(raw, `${name} still contains ${token}`).not.toContain(token);
    }
  });

  it.each(GOLDEN)("%s declares the current contract version", (name) => {
    const raw = readFileSync(join(goldenDir, name), "utf8");
    const event = JSON.parse(raw) as ChangeImpactEvent;
    expect(event.eventVersion).toBe(CHANGE_IMPACT_EVENT_VERSION);
  });

  it("would notice a fixture regressed to the old vocabulary", () => {
    // The detector, run against a deliberately reverted copy. Without this the
    // test above passes trivially on any file that happens not to contain the
    // strings, including an empty one.
    const raw = readFileSync(join(goldenDir, GOLDEN[0]!), "utf8");
    const reverted = raw.replace(/"checkExecuted"/g, '"verified"');
    expect(reverted).not.toBe(raw);
    expect(SUPERSEDED.some((token) => reverted.includes(token))).toBe(true);
  });

  it("refuses a fixture pinned to the previous contract version, naming where to migrate", () => {
    const raw = readFileSync(join(goldenDir, GOLDEN[0]!), "utf8");
    const stale = { ...(JSON.parse(raw) as ChangeImpactEvent), eventVersion: "1.2" };
    const problems = validateEvent(stale);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/1\.2 is superseded by 1\.3/);
    expect(problems[0]).toMatch(/re-emit/);
  });
});
