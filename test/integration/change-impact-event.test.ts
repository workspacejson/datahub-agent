import { describe, expect, it } from "vitest";

import {
  CHANGE_IMPACT_EVENT_VERSION,
  deriveTier,
  toDataHubOnly,
  validateEvent,
  type ChangeImpactEvent,
  type EvidenceRecord,
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
