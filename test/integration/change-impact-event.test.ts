import { describe, expect, it } from "vitest";

import {
  CHANGE_IMPACT_EVENT_VERSION,
  deriveTier,
  toDataHubOnly,
  validateEvent,
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
      workspaceArtifact: { producedBy: "@workspacejson/cli", fileIndexKeys: 36 },
    },
    subject: { urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,db.schema.model,PROD)" },
    datahub: {
      name: "model",
      platform: "dbt",
      description: null,
      upstreams: [{ urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,db.schema.up,PROD)", name: "up", degree: 1 }],
      downstreams: [{ urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,db.schema.down,PROD)", name: "down", degree: 1 }],
      lineageObservation: {
        upstreams: { read: "ok", completeness: "unverified", observedCount: 1 },
        downstreams: { read: "ok", completeness: "unverified", observedCount: 1 },
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
      records: [{ claim: "tracked", observation: "key present", source: "workspacejson", verified: true }],
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
  const record = (verified: boolean): EvidenceRecord => ({
    claim: "c",
    observation: "o",
    source: "datahub",
    verified,
  });

  it("is ASSERTED with no records — a claim with nothing behind it", () => {
    expect(deriveTier([])).toBe("ASSERTED");
  });

  it("is OBSERVED when records exist but none were executed here", () => {
    expect(deriveTier([record(false), record(false)])).toBe("OBSERVED");
  });

  it("is VERIFIED when at least one record was executed by this harness", () => {
    expect(deriveTier([record(false), record(true)])).toBe("VERIFIED");
  });

  it("takes no input but the records, so no caller can tune it", () => {
    // The tier is the whole trust signal. If it accepted a threshold or an
    // override, it would become an opinion rather than a function of evidence.
    expect(deriveTier.length).toBe(1);
  });
});

describe("completeness as an axis of its own", () => {
  /** An event whose lineage is empty, with one unavailable entry to describe it. */
  const withLineageEntry = (entry: Partial<Unavailable>): ChangeImpactEvent => {
    const event = validEvent();
    event.datahub.upstreams = [];
    event.datahub.lineageObservation.upstreams = {
      read: "ok",
      completeness: "unverified",
      observedCount: 0,
    };
    event.unavailable = [
      {
        field: "datahub.upstreams",
        source: "datahub",
        reason: "indeterminate",
        detail: "the lineage query succeeded; whether it is complete is unknown",
        completeness: "unverified",
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

  it("rejects an absent claim resting on an unverified answer", () => {
    // A partially converged index returning zero satisfies "asked and got
    // nothing" while being no evidence at all about the data. This is the
    // defect, expressed as a contract rule.
    const problems = validateEvent(
      withLineageEntry({ reason: "absent", completeness: "unverified" }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/absent.*unverified.*use indeterminate/);
  });

  it("does not let claiming verified completeness be enough to earn absent", () => {
    // `absent` is not banned — it is earned, and the word alone does not earn
    // it. Flipping completeness to `verified` without an attestation behind it
    // would make the second axis a laundering step for the first. The
    // acceptance case lives in the evidence suite below.
    expect(
      validateEvent(withLineageEntry({ reason: "absent", completeness: "verified" }))[0],
    ).toMatch(/without evidence/);
  });

  it("rejects indeterminate on an answer that was verified", () => {
    // The converse guard, so the two words cannot drift into synonyms.
    const problems = validateEvent(
      withLineageEntry({ reason: "indeterminate", completeness: "verified" }),
    );
    expect(problems[0]).toMatch(/indeterminate.*verified/);
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
    expect(entry.completeness).toBe("unverified");
  });

  it("rejects a negative observedCount", () => {
    expect(validateEvent(withLineageEntry({ observedCount: -1 }))[0]).toMatch(/negative/);
  });

  it("rejects an observedCount that disagrees with the edges carried", () => {
    // The count is a summary of the set, not a second independent claim. If
    // they can drift, the summary becomes the thing consumers trust.
    expect(validateEvent(withLineageEntry({ observedCount: 3 }))[0]).toMatch(
      /observedCount 3 but carries 0 entries/,
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

describe("verified completeness must carry its evidence", () => {
  const EVIDENCE: VerificationEvidence = {
    manifestDigest: "sha256:aaa",
    expectedSetDigest: "sha256:bbb",
    observedSetDigest: "sha256:bbb",
    queryParameters: { surface: "searchAcrossLineage", direction: "UPSTREAM", maxHops: 3 },
  };

  const verifiedAbsence = (verification?: Partial<VerificationEvidence>): ChangeImpactEvent => {
    const event = validEvent();
    event.datahub.upstreams = [];
    event.datahub.lineageObservation.upstreams = {
      read: "ok",
      completeness: "unverified",
      observedCount: 0,
    };
    event.unavailable = [
      {
        field: "datahub.upstreams",
        source: "datahub",
        reason: "absent",
        detail: "checked against the frozen readiness manifest; the catalog holds no upstreams",
        completeness: "verified",
        observedCount: 0,
        ...(verification === undefined ? {} : { verification: { ...EVIDENCE, ...verification } }),
      },
    ];
    return event;
  };

  it("accepts a verified absence backed by manifest and set digests", () => {
    expect(validateEvent(verifiedAbsence({}))).toEqual([]);
  });

  it("rejects verified completeness with no evidence block at all", () => {
    // Without this the second axis is just a new place to assert the word.
    expect(validateEvent(verifiedAbsence())[0]).toMatch(/without evidence \(verification\)/);
  });

  it.each(["manifestDigest", "expectedSetDigest", "observedSetDigest"] as const)(
    "rejects verified completeness missing %s",
    (field) => {
      expect(validateEvent(verifiedAbsence({ [field]: "" }))[0]).toMatch(field);
    },
  );

  it("rejects verified completeness with no query parameters", () => {
    // Two sets are only comparable under the same parameters, so they are part
    // of the evidence rather than commentary on it.
    expect(validateEvent(verifiedAbsence({ queryParameters: {} }))[0]).toMatch(/queryParameters/);
  });

  it("does not require evidence for an unverified answer", () => {
    // `unverified` is the honest default and must stay cheap to state.
    const event = verifiedAbsence({});
    event.unavailable[0]!.reason = "indeterminate";
    event.unavailable[0]!.completeness = "unverified";
    delete event.unavailable[0]!.verification;
    expect(validateEvent(event)).toEqual([]);
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
        reason: "absent",
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
});

describe("toDataHubOnly", () => {
  it("removes repository-sourced partners", () => {
    expect(toDataHubOnly(validEvent()).partners).toEqual([]);
  });

  it("keeps only DataHub-sourced evidence and recomputes the tier", () => {
    const event = validEvent({
      evidence: {
        records: [
          { claim: "a", observation: "o", source: "workspacejson", verified: true },
          { claim: "b", observation: "o", source: "datahub", verified: false },
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
});
