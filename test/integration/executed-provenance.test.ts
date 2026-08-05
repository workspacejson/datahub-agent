/**
 * Contract 1.4's separation of declared from executed query parameters.
 *
 * Under 1.3 one field held the readiness manifest's *derivation* parameters
 * while the contract's own prose, the completeness gate and the cockpit all
 * read it as the parameters of the read that produced `observedSetDigest`. On
 * `--transport mcp` those were different requests, so the event stated, inside
 * the structure whose entire purpose is letting someone re-derive the result,
 * parameters that would not re-derive it.
 *
 * The number was right, which is what stopped the mislabel announcing itself:
 * HAC-231 established that MCP and GraphQL return identical URN sets here, so
 * the digests agreed and nothing looked wrong.
 *
 * These tests hold the two apart. The direction invariant gets its own
 * treatment at the bottom, because the danger in this fix was never that it
 * would be wrong — it was that it would leave a guard that cannot fail.
 */

import { describe, expect, it } from "vitest";

import {
  CHANGE_IMPACT_EVENT_VERSION,
  declaredParameters,
  hasExecutedRead,
  validateEvent,
  type ChangeImpactEvent,
  type VerificationEvidenceV14,
} from "../../src/integration/change-impact-event.js";
import { LINEAGE_QUERY_PARAMETERS } from "../../src/integration/mcp-read.js";

/** The manifest's own parameters — GraphQL-shaped, and never a description of a read. */
const DECLARED = {
  surface: "searchAcrossLineage",
  direction: "UPSTREAM",
  maxDegree: 4,
  query: "*",
  start: 0,
  count: 50,
} as const;

const MCP_EXECUTED: VerificationEvidenceV14["executedRead"] = {
  transport: "mcp",
  surface: "mcp:get_lineage",
  parameters: { ...LINEAGE_QUERY_PARAMETERS, direction: "UPSTREAM" },
};

const GMS_EXECUTED: VerificationEvidenceV14["executedRead"] = {
  transport: "gms",
  surface: "searchAcrossLineage",
  parameters: { surface: "searchAcrossLineage", query: "*", start: 0, count: 50, direction: "UPSTREAM" },
};

const evidence = (
  executedRead: VerificationEvidenceV14["executedRead"],
): VerificationEvidenceV14 => ({
  manifestDigest: "manifest",
  expectedSetDigest: "set",
  observedSetDigest: "set",
  declaredQueryParameters: { ...DECLARED },
  executedRead,
});

function eventWith(verification: VerificationEvidenceV14): ChangeImpactEvent {
  return {
    eventVersion: CHANGE_IMPACT_EVENT_VERSION,
    provenance: {
      producedAt: "2026-08-05T00:00:00.000Z",
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
      upstreams: [
        { urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,db.schema.up,PROD)", name: "up", degree: 1 },
      ],
      downstreams: [
        { urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,db.schema.down,PROD)", name: "down", degree: 1 },
      ],
      lineageObservation: {
        upstreams: {
          read: "ok",
          completeness: "complete-against-pinned-manifest",
          observedCount: 1,
          verification,
        },
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
      records: [
        { claim: "tracked", observation: "key present", source: "workspacejson", checkExecuted: true },
      ],
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

describe("the transport that ran is the transport that is recorded", () => {
  it("records mcp:get_lineage for an MCP-transport read", () => {
    const event = eventWith(evidence(MCP_EXECUTED));
    expect(validateEvent(event)).toEqual([]);
    const v = event.datahub.lineageObservation.upstreams.verification!;
    expect(hasExecutedRead(v) && v.executedRead.surface).toBe("mcp:get_lineage");
    expect(hasExecutedRead(v) && v.executedRead.transport).toBe("mcp");
  });

  it("records searchAcrossLineage for a GraphQL-transport read", () => {
    const event = eventWith(evidence(GMS_EXECUTED));
    expect(validateEvent(event)).toEqual([]);
    const v = event.datahub.lineageObservation.upstreams.verification!;
    expect(hasExecutedRead(v) && v.executedRead.surface).toBe("searchAcrossLineage");
    expect(hasExecutedRead(v) && v.executedRead.transport).toBe("gms");
  });

  it("takes the MCP parameters from the constant the read path itself uses", () => {
    // The whole defect in miniature was a documented, exported constant with no
    // consumer sitting beside a hand-copy of the same values. If these drift,
    // the recorded provenance stops describing the request the read path makes.
    expect(MCP_EXECUTED.parameters).toMatchObject(LINEAGE_QUERY_PARAMETERS);
    expect(LINEAGE_QUERY_PARAMETERS.surface).toBe("mcp:get_lineage");
  });

  it("keeps the two parameter sets distinguishable, and neither describes the other", () => {
    // The concrete case from HAC-284: the manifest declares maxDegree 4 on
    // searchAcrossLineage; the MCP read that produced the observed set ran
    // get_lineage at three hops. Both are recorded, and an auditor can tell
    // which is which.
    const v = evidence(MCP_EXECUTED);
    expect(declaredParameters(v)["surface"]).toBe("searchAcrossLineage");
    expect(v.executedRead.surface).toBe("mcp:get_lineage");
    expect(declaredParameters(v)["maxDegree"]).toBe(4);
    expect(v.executedRead.parameters["maxDegree"]).toBeUndefined();
    expect(v.executedRead.parameters["maxHops"]).toBe(3);
  });

  it("still records both when the transport happens to match the manifest's surface", () => {
    // A GraphQL run is the easy case, and the one where collapsing the fields
    // would look harmless. It is not: the executed read never sends maxDegree,
    // so even here the two sets differ.
    const v = evidence(GMS_EXECUTED);
    expect(v.executedRead.surface).toBe(declaredParameters(v)["surface"]);
    expect(declaredParameters(v)["maxDegree"]).toBe(4);
    expect(v.executedRead.parameters["maxDegree"]).toBeUndefined();
  });
});

describe("the direction invariant still fires, on the executed read", () => {
  // This is the assertion the issue asks to be proved by watching it fail
  // rather than by watching it pass. `LINEAGE_QUERY_PARAMETERS` carries no
  // `direction` key, so the naive version of this change — swap the value in,
  // keep the lookup — leaves `stated` undefined, short-circuits, and produces a
  // check that cannot fail. The three tests below are: it fires, it fires for
  // the right reason, and the input that would disarm it is refused outright.

  it("refuses evidence whose executed read ran the other direction", () => {
    const event = eventWith(
      evidence({ ...GMS_EXECUTED, parameters: { ...GMS_EXECUTED.parameters, direction: "DOWNSTREAM" } }),
    );
    const problems = validateEvent(event);
    expect(problems).toContainEqual(expect.stringContaining("executed DOWNSTREAM"));
    expect(problems).toContainEqual(expect.stringContaining("describes UPSTREAM lineage"));
  });

  it("names the surface it ran on, so the reader can check the right query", () => {
    const event = eventWith(
      evidence({ ...MCP_EXECUTED, parameters: { ...MCP_EXECUTED.parameters, direction: "DOWNSTREAM" } }),
    );
    expect(validateEvent(event)).toContainEqual(expect.stringContaining("mcp:get_lineage"));
  });

  it("refuses an executed read with no direction at all, rather than skipping the check", () => {
    // The disarming input. If this were accepted, every test above would still
    // pass and the invariant would be dead.
    const { direction: _dropped, ...withoutDirection } = GMS_EXECUTED.parameters;
    const event = eventWith(
      evidence({ ...GMS_EXECUTED, parameters: withoutDirection as never }),
    );
    expect(validateEvent(event)).not.toEqual([]);
  });

  it("accepts the matching direction, so the guard is not simply always-refuse", () => {
    expect(validateEvent(eventWith(evidence(GMS_EXECUTED)))).toEqual([]);
  });

  it("reads the executed direction and not the manifest's", () => {
    // The manifest says UPSTREAM and the read ran DOWNSTREAM. Under 1.3 the one
    // field said UPSTREAM and the invariant passed; the read it described had
    // gone the other way. Only the executed side can catch this.
    const event = eventWith({
      ...evidence(GMS_EXECUTED),
      declaredQueryParameters: { ...DECLARED, direction: "UPSTREAM" },
      executedRead: { ...GMS_EXECUTED, parameters: { ...GMS_EXECUTED.parameters, direction: "DOWNSTREAM" } },
    });
    expect(validateEvent(event)).toContainEqual(expect.stringContaining("executed DOWNSTREAM"));
  });
});
