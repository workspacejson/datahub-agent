import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CHANGE_IMPACT_EVENT_VERSION,
  deriveTier,
  toDataHubOnly,
  validateEvent,
  SUPERSEDED_EVENT_VERSIONS,
  type ChangeImpactEvent,
  type EvidenceRecord,
  type Unavailable,
  type VerificationEvidence,
} from "../../src/integration/change-impact-event.js";

/** A minimal event that passes validation — every test mutates one thing from here. */
function validEvent(overrides: Partial<ChangeImpactEvent> = {}): ChangeImpactEvent {
  return {
    eventVersion: CHANGE_IMPACT_EVENT_VERSION,
    provenance: {
      producedAt: "2026-07-27T00:00:00.000Z",
      producer: { name: "@workspacejson/datahub-agent", version: "0.0.1" },
      datahub: { gmsUrl: "http://localhost:8080", gmsVersion: "v1.5.0.6" },
      corpus: { repository: "https://github.com/example/repo", commit: "a".repeat(40) },
      workspaceArtifact: {
        producedBy: "@workspacejson/cli",
        fileIndexKeys: 36,
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
      method: "external-url",
      sourceUrl: `https://github.com/example/repo/blob/${"a".repeat(40)}/dbt/models/model.sql`,
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
    ...overrides,
  };
}

describe("deriveTier", () => {
  const record = (checkExecuted: boolean): EvidenceRecord => ({
    claim: "c",
    observation: "o",
    source: "datahub",
    checkExecuted,
  });

  it("is ASSERTED with no records — a claim with nothing behind it", () => {
    expect(deriveTier([])).toBe("ASSERTED");
  });

  it("is OBSERVED when records exist but none were executed here", () => {
    expect(deriveTier([record(false), record(false)])).toBe("OBSERVED");
  });

  it("is OBSERVED when not all records were executed by this harness", () => {
    expect(deriveTier([record(false), record(true)])).toBe("OBSERVED");
  });

  it.each([
    ["ASSERTED", []],
    ["OBSERVED", [false, false]],
    ["OBSERVED", [false, true]],
    ["VERIFIED", [true, true]],
  ] as const)("derives %s for the given check-execution pattern", (expected, checks) => {
    expect(deriveTier(checks.map(record))).toBe(expected);
  });

  it("takes no input but the records, so no caller can tune it", () => {
    // The tier is the whole trust signal. If it accepted a threshold or an
    // override, it would become an opinion rather than a function of evidence.
    expect(deriveTier.length).toBe(1);
  });
});

describe("the version a consumer compiles against", () => {
  it("names a superseded version and says to re-emit, not what field is missing", () => {
    // A 1.0 artifact predates lineageObservation. Reporting "missing field"
    // would send a reviewer looking for a bug in a file that was correct under
    // the contract it was written for.
    const event = { ...validEvent(), eventVersion: "1.0" } as unknown as ChangeImpactEvent;
    const problems = validateEvent(event);
    expect(problems).toHaveLength(1);
    // Against the current version rather than a literal: the behaviour under
    // test is that the message names where to migrate to, which stays true
    // across bumps. Hardcoding it fails every bump for no semantic reason.
    expect(problems[0]).toMatch(
      new RegExp(`1\\.0 is superseded by ${CHANGE_IMPACT_EVENT_VERSION.replace(".", "\\.")}`),
    );
    expect(problems[0]).toMatch(/re-emit/);
  });

  it("does not report shape problems against a version whose shape differed", () => {
    // Running current-shape checks over an older event produces noise about
    // fields that were never meant to be there.
    const stale = { ...validEvent(), eventVersion: "1.0" } as unknown as ChangeImpactEvent;
    delete (stale.datahub as { lineageObservation?: unknown }).lineageObservation;
    expect(validateEvent(stale)).toHaveLength(1);
  });

  it("still rejects a version it has never heard of", () => {
    const event = { ...validEvent(), eventVersion: "9.9" } as unknown as ChangeImpactEvent;
    expect(validateEvent(event)[0]).toMatch(/unknown eventVersion 9\.9/);
  });

  it("offers no in-place upgrade from any superseded version, deliberately", () => {
    // 1.0 lacked lineageObservation; 1.1 lacked the workspace artifact's corpus
    // identity. In both cases a synthesised value would be invented rather than
    // observed — manufacturing an observation nobody made, on the exact axis the
    // field exists to keep honest.
    //
    // 1.2 is the interesting one: it is a pure rename whose values map one to
    // one, so a mechanical upgrade was available and was still declined. A 1.2
    // `verified: true` may have meant "a check ran" or "the claim holds", and
    // this project's own emitter did not reliably mean the first — mapping it
    // silently onto `checkExecuted` would launder that ambiguity and call it
    // migrated. So every entry says re-emit, including the easy one.
    expect(Object.keys(SUPERSEDED_EVENT_VERSIONS)).toEqual(["1.0", "1.1", "1.2"]);
    for (const [version, guidance] of Object.entries(SUPERSEDED_EVENT_VERSIONS)) {
      expect(guidance, `${version} must direct the reader to re-emit`).toMatch(/re-emit/);
    }
  });

  it("names what a 1.1 event cannot carry, rather than reporting a missing field", () => {
    const event = { ...validEvent(), eventVersion: "1.1" } as unknown as ChangeImpactEvent;
    const problems = validateEvent(event);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/workspaceArtifact/);
    expect(problems[0]).toMatch(/re-emit/);
  });
});

describe("completeness as an axis of its own", () => {
  /** An event whose lineage is empty, with one unavailable entry to describe it. */
  const withLineageEntry = (entry: Partial<Unavailable>): ChangeImpactEvent => {
    const event = validEvent();
    event.datahub.upstreams = [];
    event.datahub.lineageObservation.upstreams = {
      read: "ok",
      completeness: "not-established",
      observedCount: 0,
    };
    event.unavailable = [
      {
        field: "datahub.upstreams",
        source: "datahub",
        reason: "indeterminate",
        detail: "the lineage query succeeded; whether it is complete is unknown",
        completeness: "not-established",
        observedCount: 0,
        ...entry,
      },
    ];
    return event;
  };

  it("accepts a zero result reported as indeterminate and unverified", () => {
    // The shape this issue exists to make sayable: asked, answered, and the
    // answer cannot be trusted to be whole.
    expect(validateEvent(withLineageEntry({}))).toEqual([]);
  });

  it("rejects an absent claim resting on an answer whose completeness was never established", () => {
    // A partially converged index returning zero satisfies "asked and got
    // nothing" while being no evidence at all about the data. This is the
    // defect, expressed as a contract rule.
    const problems = validateEvent(
      withLineageEntry({ reason: "absent", completeness: "not-established" }),
    );
    // Two complementary refusals, named rather than counted: the entry's own
    // claim is refused, and so is its disagreement with the canonical
    // observation. A length assertion here broke when the second guard was
    // added, reporting a tightening as a regression.
    expect(problems).toContainEqual(
      expect.stringMatching(/absent.*not-established.*use indeterminate/),
    );
    expect(problems).toContainEqual(
      expect.stringContaining("absence is only sayable about an answer established complete"),
    );
  });

  it("does not let claiming complete-against-pinned-manifest be enough to earn absent", () => {
    // `absent` is not banned — it is earned, and the word alone does not earn
    // it. Flipping completeness to `verified` without an attestation behind it
    // would make the second axis a laundering step for the first. The
    // acceptance case lives in the evidence suite below.
    expect(
      validateEvent(withLineageEntry({ reason: "absent", completeness: "complete-against-pinned-manifest" }))[0],
    ).toMatch(/without naming the manifest/);
  });

  it("rejects indeterminate on an answer established complete against a pinned manifest", () => {
    // The converse guard, so the two words cannot drift into synonyms.
    const problems = validateEvent(
      withLineageEntry({ reason: "indeterminate", completeness: "complete-against-pinned-manifest" }),
    );
    expect(problems[0]).toMatch(/indeterminate on an answer established complete against a pinned manifest/);
  });

  it("keeps completeness independent of why the context is missing", () => {
    // Not derived from `reason`, in either direction. A failed read and a
    // not-queried one carry no completeness at all, because neither produced
    // an answer whose completeness could be a question.
    for (const reason of ["failed", "not-queried"] as const) {
      const event = withLineageEntry({ reason });
      delete event.unavailable[0]!.completeness;
      delete event.unavailable[0]!.observedCount;
      expect(validateEvent(event)).toEqual([]);
    }
  });

  it("treats a zero observedCount as a real observation, not a missing one", () => {
    // Zero is what the query returned. It is `completeness` that decides
    // whether it may be read as absence, which is the whole separation.
    const entry = withLineageEntry({ observedCount: 0 }).unavailable[0]!;
    expect(entry.observedCount).toBe(0);
    expect(entry.completeness).toBe("not-established");
  });

  it("rejects a negative observedCount", () => {
    expect(validateEvent(withLineageEntry({ observedCount: -1 }))).toContainEqual(
      expect.stringContaining("negative observedCount"),
    );
  });

  it("rejects an observedCount that disagrees with the edges carried", () => {
    // The count is a summary of the set, not a second independent claim. If
    // they can drift, the summary becomes the thing consumers trust.
    expect(validateEvent(withLineageEntry({ observedCount: 3 }))).toContainEqual(
      expect.stringContaining("observedCount 3 but carries 0 entries"),
    );
  });

  it.each(["failed", "not-queried"] as const)(
    "rejects a manufactured zero count on a %s read",
    (reason) => {
      // No query produced that zero. Inventing one recreates the collapse in
      // arithmetic instead of vocabulary.
      const problems = validateEvent(withLineageEntry({ reason, observedCount: 0 }));
      expect(problems.some((p) => /no query produced one/.test(p))).toBe(true);
    },
  );

  it("rejects indeterminate that does not state completeness at all", () => {
    const event = withLineageEntry({});
    delete event.unavailable[0]!.completeness;
    expect(validateEvent(event)[0]).toMatch(/without stating completeness/);
  });
});

describe("complete-against-pinned-manifest must carry its evidence", () => {
  const EVIDENCE: VerificationEvidence = {
    manifestDigest: "sha256:aaa",
    expectedSetDigest: "sha256:bbb",
    observedSetDigest: "sha256:bbb",
    queryParameters: { surface: "searchAcrossLineage", direction: "UPSTREAM", maxHops: 3 },
  };

  const verifiedAbsence = (verification?: Partial<VerificationEvidence>): ChangeImpactEvent => {
    const event = validEvent();
    event.datahub.upstreams = [];
    // The canonical observation mirrors the entry, because they describe one
    // answer. This used to say `not-established` while the entry below claimed
    // `complete-against-pinned-manifest`, and validateEvent accepted it — the
    // contradiction V-1c now refuses. The helper is only a valid fixture for
    // "verified absence" if both representations actually agree.
    event.datahub.lineageObservation.upstreams = {
      read: "ok",
      completeness: "complete-against-pinned-manifest",
      observedCount: 0,
      ...(verification === undefined ? {} : { verification: { ...EVIDENCE, ...verification } }),
    };
    event.unavailable = [
      {
        field: "datahub.upstreams",
        source: "datahub",
        reason: "absent",
        detail: "checked against the frozen readiness manifest; the catalog holds no upstreams",
        completeness: "complete-against-pinned-manifest",
        observedCount: 0,
        ...(verification === undefined ? {} : { verification: { ...EVIDENCE, ...verification } }),
      },
    ];
    return event;
  };

  it("accepts a verified absence backed by manifest and set digests", () => {
    expect(validateEvent(verifiedAbsence({}))).toEqual([]);
  });

  it("rejects complete-against-pinned-manifest with no evidence block at all", () => {
    // Without this the second axis is just a new place to assert the word.
    expect(validateEvent(verifiedAbsence())[0]).toMatch(/without naming the manifest \(verification\)/);
  });

  it.each(["manifestDigest", "expectedSetDigest", "observedSetDigest"] as const)(
    "rejects complete-against-pinned-manifest missing %s",
    (field) => {
      expect(validateEvent(verifiedAbsence({ [field]: "" }))[0]).toMatch(field);
    },
  );

  it("rejects complete-against-pinned-manifest with no query parameters", () => {
    // Two sets are only comparable under the same parameters, so they are part
    // of the evidence rather than commentary on it.
    expect(validateEvent(verifiedAbsence({ queryParameters: {} }))[0]).toMatch(/queryParameters/);
  });

  it("does not require evidence when completeness was not established", () => {
    // `unverified` is the honest default and must stay cheap to state.
    const event = verifiedAbsence({});
    event.unavailable[0]!.reason = "indeterminate";
    event.unavailable[0]!.completeness = "not-established";
    delete event.unavailable[0]!.verification;
    // The canonical observation is downgraded with it. Leaving it claiming
    // complete-against-pinned-manifest would make this fixture assert the
    // contradiction V-1c refuses, rather than the cheapness of the honest
    // default it is actually about.
    event.datahub.lineageObservation.upstreams = {
      read: "ok",
      completeness: "not-established",
      observedCount: 0,
    };
    expect(validateEvent(event)).toEqual([]);
  });
});

describe("a workspace claim the artifact could not support", () => {
  // The defect HAC-225 found in the committed nested fixture: a Transfermarkt
  // subject joined against the jaffle_shop artifact, reporting the producing
  // file `absent` from an index built from a different repository — and marking
  // the claim `verified: true`. Every test here fails against 42c2806.
  //
  // These hold the event to its own recorded `integrity`. The disposition is
  // computed once at read time; validation re-derives nothing, so a refusal
  // cannot be quietly re-described as evidence further down the pipeline.
  const refusals = [
    "artifact-unavailable",
    "repository-mismatch",
    "revision-mismatch",
    "path-unresolved",
    "path-ambiguous",
  ] as const;

  function withIntegrity(
    integrity: (typeof refusals)[number] | "exact-match",
    overrides: Partial<ChangeImpactEvent> = {},
  ): ChangeImpactEvent {
    const base = validEvent();
    return {
      ...base,
      provenance: {
        ...base.provenance,
        workspaceArtifact: { ...base.provenance.workspaceArtifact!, integrity },
      },
      ...overrides,
    };
  }

  it.each(refusals)("cannot carry a checkExecuted workspacejson record when integrity is %s", (integrity) => {
    const problems = validateEvent(withIntegrity(integrity));
    expect(problems.some((p) => p.includes("record(s) marked checkExecuted"))).toBe(true);
    expect(problems.some((p) => p.includes(integrity))).toBe(true);
  });

  it.each(refusals)("cannot earn 'absent' when integrity is %s", (integrity) => {
    const problems = validateEvent(withIntegrity(integrity, {
      partners: [],
      evidence: { records: [], tier: "ASSERTED" },
      unavailable: [{
        field: "partners",
        source: "workspacejson",
        reason: "absent",
        detail: "The producing file is not present in the workspace.json artifact.",
      }],
    }));
    expect(problems.some((p) => p.includes("'absent'"))).toBe(true);
    expect(problems.some((p) => p.includes("is not absence"))).toBe(true);
  });

  it("reproduces the shipped fixture's exact shape and rejects it on both counts", () => {
    const problems = validateEvent(withIntegrity("repository-mismatch", {
      partners: [],
      evidence: {
        records: [{
          claim: "producing file dbt/models/curated/game_events.sql is tracked in the workspace.json artifact",
          observation: "key absent from generated.fileIndex (36 keys)",
          source: "workspacejson",
          checkExecuted: true,
        }],
        tier: "VERIFIED",
      },
      unavailable: [{
        field: "partners",
        source: "workspacejson",
        reason: "absent",
        detail: "The producing file is not present in the workspace.json artifact, so no co-change partners can be derived for it.",
      }],
    }));
    // Named rather than counted. A bare length assertion says nothing about
    // *which* rules fired, and it broke when a third genuinely-violated rule
    // was added — reporting the tightening as a regression.
    expect(problems).toEqual(expect.arrayContaining([
      expect.stringContaining("record(s) marked checkExecuted"),
      expect.stringContaining("absence from an unmatched artifact is not absence"),
      expect.stringContaining("claims absent without stating completeness"),
    ]));
    expect(problems).toHaveLength(3);
  });

  it("still permits DataHub-sourced verified claims — only repository evidence is gated", () => {
    // The catalog read does not depend on which workspace artifact was supplied.
    const problems = validateEvent(withIntegrity("repository-mismatch", {
      partners: [],
      evidence: {
        records: [{
          claim: "the producing file is addressable at an immutable commit",
          observation: "https://github.com/example/repo/blob/abc/dbt/models/model.sql",
          source: "datahub",
          checkExecuted: true,
        }],
        tier: "VERIFIED",
      },
      unavailable: [{
        field: "partners",
        source: "workspacejson",
        reason: "not-queried",
        detail: "The artifact describes a different repository, so the subject's corpus was never consulted.",
      }],
    }));
    expect(problems).toEqual([]);
  });

  it("accepts the same claims once integrity is exact-match", () => {
    expect(validateEvent(withIntegrity("exact-match"))).toEqual([]);
  });

  /** An event carrying an artifact block with the named keys removed. */
  function withoutIdentity(...omit: string[]): ChangeImpactEvent {
    const base = validEvent();
    const artifact: Record<string, unknown> = { ...base.provenance.workspaceArtifact };
    for (const key of omit) delete artifact[key];
    return {
      ...base,
      provenance: { ...base.provenance, workspaceArtifact: artifact },
    } as unknown as ChangeImpactEvent;
  }

  it.each(["repository", "revision", "integrity"])(
    "reports %s by path, not as a side effect of another check",
    (key) => {
      // An earlier version of this test asserted only `not.toEqual([])`, and
      // passed for the wrong reason: the helper happened to carry a
      // workspacejson record marked checkExecuted, so the refusal branch fired and the absent field
      // was never actually noticed. Naming the path is what makes this a test
      // about presence.
      const problems = validateEvent(withoutIdentity(key));
      expect(problems.some((p) => p.startsWith(`provenance.workspaceArtifact.${key}:`))).toBe(true);
    },
  );

  it("catches an artifact with no identity even when nothing claims anything from it", () => {
    // The gap the schema closes. With no checkExecuted workspacejson record and no
    // `absent` assertion, every relationship check has nothing to disagree
    // with, so the event would previously validate clean while carrying an
    // artifact whose corpus was never established.
    const stripped = withoutIdentity("repository", "revision", "integrity");
    const problems = validateEvent({
      ...stripped,
      partners: [],
      evidence: {
        records: [{ claim: "c", observation: "o", source: "datahub", checkExecuted: true }],
        tier: "VERIFIED",
      },
      unavailable: [{
        field: "partners",
        source: "workspacejson",
        reason: "not-queried",
        detail: "nothing was claimed from the artifact",
      }],
    });
    expect(problems).toHaveLength(3);
    for (const key of ["repository", "revision", "integrity"]) {
      expect(problems.some((p) => p.startsWith(`provenance.workspaceArtifact.${key}:`))).toBe(true);
    }
  });
});

describe("validateEvent", () => {
  it("accepts a well-formed event", () => {
    expect(validateEvent(validEvent())).toEqual([]);
  });

  it("rejects accounting that does not reconcile", () => {
    const problems = validateEvent(
      validEvent({
        accounting: {
          datasetsRequested: 5,
          datasetsResolved: 1,
          datasetsUnresolved: 1,
          nodesDropped: 0,
          nodesExcluded: {},
        },
      }),
    );
    expect(problems.join(" ")).toMatch(/does not reconcile/);
  });

  // HAC-267 / HAC-146 Invariants: "unresolved counts without the matching named
  // unresolved items". Specified at the freeze, built 2026-07-29.
  describe("named unresolved records", () => {
    const withRecords = (datasetsUnresolved: number, unresolvedRecords?: Array<{ urn: string; reason: string }>) =>
      validEvent({
        accounting: {
          datasetsRequested: 1 + datasetsUnresolved,
          datasetsResolved: 1,
          datasetsUnresolved,
          nodesDropped: 0,
          nodesExcluded: {},
          ...(unresolvedRecords ? { unresolvedRecords } : {}),
        },
      });

    it("accepts an event that omits the field, because older artifacts carry only the count", () => {
      expect(validateEvent(withRecords(2))).toEqual([]);
    });

    it("accepts a list that names every unresolved dataset", () => {
      expect(validateEvent(withRecords(2, [
        { urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.a,PROD)", reason: "no producing node" },
        { urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.b,PROD)", reason: "path ambiguous" },
      ]))).toEqual([]);
    });

    it("rejects a partial list, which would read as a complete one", () => {
      // The failure this field exists to prevent: two unresolved, one named. A
      // reader sees a list and has no way to know it is short.
      const problems = validateEvent(withRecords(2, [
        { urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.a,PROD)", reason: "no producing node" },
      ]));
      expect(problems.join(" ")).toMatch(/names 1 unresolved dataset\(s\) but counts 2/);
    });

    it("rejects more names than the count, so the list cannot overstate either", () => {
      const problems = validateEvent(withRecords(1, [
        { urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.a,PROD)", reason: "no producing node" },
        { urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.b,PROD)", reason: "path ambiguous" },
      ]));
      expect(problems.join(" ")).toMatch(/names 2 unresolved dataset\(s\) but counts 1/);
    });

    it("rejects a duplicated dataset, which would pad a short list to the right length", () => {
      const urn = "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.a,PROD)";
      const problems = validateEvent(withRecords(2, [
        { urn, reason: "no producing node" },
        { urn, reason: "no producing node" },
      ]));
      expect(problems.join(" ")).toMatch(/names the same unresolved dataset more than once/);
    });

    it("rejects a record with an empty reason, because a name alone does not establish scope", () => {
      const problems = validateEvent(withRecords(1, [
        { urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.a,PROD)", reason: "" },
      ]));
      expect(problems.length).toBeGreaterThan(0);
    });
  });

  it("rejects a tier that is not the mechanical function of the records", () => {
    const event = validEvent();
    event.evidence.tier = "ASSERTED"; // records contain a verified item
    expect(validateEvent(event).join(" ")).toMatch(/not the mechanical function/);
  });

  it("rejects an unknown event version", () => {
    const event = validEvent();
    (event as { eventVersion: string }).eventVersion = "9.9";
    expect(validateEvent(event).join(" ")).toMatch(/unknown eventVersion/);
  });

  // The core requirement: zero edges must not be readable as proof of none.
  it.each([
    ["datahub.upstreams", (e: ChangeImpactEvent) => { e.datahub.upstreams = []; }],
    ["datahub.downstreams", (e: ChangeImpactEvent) => { e.datahub.downstreams = []; }],
    ["partners", (e: ChangeImpactEvent) => { e.partners = []; }],
  ])("rejects an empty %s with no stated reason", (field, empty) => {
    const event = validEvent();
    empty(event);
    expect(validateEvent(event).join(" ")).toContain(field);
  });

  it("accepts an empty collection when the reason is stated", () => {
    const event = validEvent({ partners: [] });
    event.unavailable = [
      {
        field: "partners",
        source: "workspacejson",
        // This used to say `absent`, and validated clean while stating no
        // completeness at all — the hole V-1b now closes. `indeterminate` is
        // both the honest word here and the one the emitter produces: an
        // artifact holding index keys but no co-change values has not
        // established that no co-change exists.
        reason: "indeterminate",
        completeness: "not-established",
        observedCount: 0,
        detail: "the artifact carries keys but no behavioral values",
      },
    ];
    expect(validateEvent(event)).toEqual([]);
  });

  it("rejects an unresolved resolution that still carries a path", () => {
    const event = validEvent();
    event.code.method = "unresolved";
    expect(validateEvent(event).join(" ")).toMatch(/unresolved but a repositoryRelativePath/);
  });

  it("returns problems rather than throwing, so a receipt can show them", () => {
    // Throwing would lose the event, which is the failure mode this contract
    // exists to prevent — a consumer must be able to render a broken event.
    const event = validEvent();
    event.evidence.tier = "ASSERTED";
    expect(() => validateEvent(event)).not.toThrow();
    expect(validateEvent(event).length).toBeGreaterThan(0);
  });

  it("accepts an event with no workspace artifact at all", () => {
    const event = validEvent();
    event.provenance.workspaceArtifact = null;
    expect(validateEvent(event)).toEqual([]);
  });

  it("rejects a missing lineageObservation on upstreams", () => {
    const event = validEvent();
    delete (event.datahub as { lineageObservation?: unknown }).lineageObservation;
    const problems = validateEvent(event);
    expect(problems.some((p) => p.includes("lineageObservation") && p.includes("missing"))).toBe(true);
  });

  it("rejects read:ok without an observedCount on upstreams", () => {
    const event = validEvent();
    event.datahub.lineageObservation.upstreams = { read: "ok", completeness: "not-established" };
    const problems = validateEvent(event);
    expect(problems.some((p) => p.includes("read ok without an observedCount"))).toBe(true);
  });

  it("rejects read:failed with edges present", () => {
    const event = validEvent();
    event.datahub.lineageObservation.upstreams = { read: "failed", completeness: "not-established" };
    const problems = validateEvent(event);
    expect(problems.some((p) => p.includes("failed") && p.includes("edges are present"))).toBe(true);
  });

  it("rejects read:failed that claims verified completeness", () => {
    const event = validEvent();
    event.datahub.upstreams = [];
    event.datahub.lineageObservation.upstreams = { read: "failed", completeness: "complete-against-pinned-manifest" };
    const problems = validateEvent(event);
    expect(problems.some((p) => p.includes("complete-against-pinned-manifest on a read that did not happen"))).toBe(true);
  });

  it("rejects read:not-queried with an observedCount", () => {
    const event = validEvent();
    event.datahub.upstreams = [];
    event.datahub.lineageObservation.upstreams = { read: "not-queried", completeness: "not-established", observedCount: 0 };
    const problems = validateEvent(event);
    expect(problems.some((p) => p.includes("not-queried") && p.includes("observedCount"))).toBe(true);
  });
});

describe("toDataHubOnly", () => {
  it("removes repository-sourced partners", () => {
    expect(toDataHubOnly(validEvent()).partners).toEqual([]);
  });

  it("keeps only DataHub-sourced evidence and recomputes the tier", () => {
    const event = validEvent({
      evidence: {
        records: [
          { claim: "a", observation: "o", source: "workspacejson", checkExecuted: true },
          { claim: "b", observation: "o", source: "datahub", checkExecuted: false },
        ],
        tier: "VERIFIED",
      },
    });
    const reduced = toDataHubOnly(event);
    expect(reduced.evidence.records.map((r) => r.source)).toEqual(["datahub"]);
    expect(reduced.evidence.tier).toBe("OBSERVED");
  });

  it("states why partners are absent rather than leaving an empty list", () => {
    const reduced = toDataHubOnly(validEvent());
    const entry = reduced.unavailable.find((u) => u.field === "partners");
    expect(entry?.reason).toBe("not-queried");
    expect(entry?.detail).toMatch(/1 co-changing file/);
  });

  it("produces an event that still satisfies the contract", () => {
    // The reduced view is shown to judges beside the joined one. If it failed
    // validation, the comparison would be between a valid event and a broken
    // one rather than between two context levels.
    expect(validateEvent(toDataHubOnly(validEvent()))).toEqual([]);
  });

  it("downgrades a manifest-join resolution, which DataHub alone cannot make", () => {
    const event = validEvent();
    event.code.method = "manifest-join";
    const reduced = toDataHubOnly(event);
    expect(reduced.code.method).toBe("unresolved");
    expect(reduced.code.repositoryRelativePath).toBeNull();
  });

  it("preserves a resolution DataHub made by itself", () => {
    // external-url comes from the catalog, so it survives the reduction. This
    // is the distinction that makes the comparison honest rather than rigged.
    const reduced = toDataHubOnly(validEvent());
    expect(reduced.code.method).toBe("external-url");
    expect(reduced.code.repositoryRelativePath).toBe("dbt/models/model.sql");
  });

  it("preserves a dbt-file-path resolution, which DataHub also supplies", () => {
    const event = validEvent();
    event.code.method = "dbt-file-path";
    const reduced = toDataHubOnly(event);
    expect(reduced.code.method).toBe("dbt-file-path");
    expect(reduced.code.repositoryRelativePath).toBe("dbt/models/model.sql");
  });

  it("states a different detail when no partners were present to withhold", () => {
    const event = validEvent({ partners: [] });
    event.unavailable = [
      { field: "partners", source: "workspacejson", reason: "absent", detail: "no partners" },
    ];
    const reduced = toDataHubOnly(event);
    const entry = reduced.unavailable.find((u) => u.field === "partners" && u.reason === "not-queried");
    expect(entry?.detail).toMatch(/no co-change is computed/);
    expect(entry?.detail).not.toMatch(/co-changing file/);
  });
});

describe("the MCP restriction the emitter operates under", () => {
  const emitter = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../scripts/emit-change-impact-event.mjs"),
    "utf8",
  );

  it("does not request externalUrl, which MCP drops for Dataset", () => {
    // evaluation/mcp-field-coverage.md measures `externalUrl` as DROPPED AT THE
    // MCP BOUNDARY for Dataset. Reading it would make the event describe a
    // capability an MCP agent does not have.
    const graphqlRequests = emitter
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"));
    expect(graphqlRequests.some((l) => l.includes("externalUrl"))).toBe(false);
  });

  it("cannot produce external-url resolution while that restriction holds", () => {
    // The vocabulary keeps `external-url` because HAC-156 exposes the field
    // upstream. Until then it must be unreachable, and unreachable-by-test
    // rather than unreachable-by-accident — the difference between a documented
    // gate and a claim nobody noticed had stopped being true.
    expect(emitter).not.toMatch(/method\s*=\s*"external-url"/);
  });

  it("states the cost of the restriction rather than working around it", () => {
    expect(emitter).toMatch(/const sourceUrl = null/);
    expect(emitter).toMatch(/HAC-156/);
  });
});

describe("the DataHub-only reduction", () => {
  it("drops workspace-sourced absences instead of carrying them alongside not-queried", () => {
    // The reduced view previously held two mutually exclusive claims about one
    // field: `absent` (asked, reported nothing) beside `not-queried` (never
    // asked), both marked source workspacejson — in the one view whose premise
    // is that no workspace evidence was consulted.
    const event = validEvent({
      partners: [],
      evidence: { records: [{ claim: "c", observation: "o", source: "datahub", checkExecuted: true }], tier: "VERIFIED" },
      unavailable: [{
        field: "partners", source: "workspacejson", reason: "absent",
        detail: "The artifact carries file-index keys but no behavioral co-change values.",
      }],
    });
    const reduced = toDataHubOnly(event);
    const partners = reduced.unavailable.filter((u) => u.field === "partners");
    expect(partners).toHaveLength(1);
    expect(partners[0]?.reason).toBe("not-queried");
  });

  it("retains DataHub-sourced absences, which that mode could genuinely observe", () => {
    const event = validEvent({
      unavailable: [{
        field: "datahub.upstreams", source: "datahub", reason: "indeterminate",
        detail: "the lineage query succeeded; completeness is unknown",
        completeness: "not-established", observedCount: 0,
      }],
    });
    expect(toDataHubOnly(event).unavailable.some((u) => u.field === "datahub.upstreams")).toBe(true);
  });

  it("still satisfies the contract after the reduction", () => {
    expect(validateEvent(toDataHubOnly(validEvent()))).toEqual([]);
  });
});
