import { describe, expect, it } from "vitest";

import { contractEvent } from "../test/contract-event";

import { projectEvent, readChangeImpactEvent } from "./from-change-impact-event";
import { cockpitViewModelSchema } from "./cockpit-view-model";

describe("projecting the frozen contract onto the cockpit", () => {
  it("renders an event the emitter can actually produce", () => {
    // The property that did not previously exist. `createAdapter` cast an
    // `unknown` to `SourceEvent`, so nothing established that a real
    // ChangeImpactEvent could produce a valid view model at all.
    const result = readChangeImpactEvent(contractEvent(), "impact");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(cockpitViewModelSchema.safeParse({ ...result.event, sourceMode: "fixture" }).success).toBe(true);
  });

  it("names the offending path when an event violates the contract", () => {
    const broken = contractEvent();
    delete (broken as { subject?: unknown }).subject;
    const result = readChangeImpactEvent(broken, "impact");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toContain("subject: is missing");
  });

  it("refuses an undeclared key rather than carrying it into the view", () => {
    const polluted = { ...contractEvent(), invented: "plausible-looking" };
    const result = readChangeImpactEvent(polluted, "impact");
    expect(result.ok).toBe(false);
  });

  it("carries a null source URL through instead of inventing a link", () => {
    // externalUrl is dropped at the MCP boundary, so an honest read path often
    // has no commit-pinned URL. The view must say so, not fabricate one.
    const model = projectEvent(contractEvent(), "impact");
    expect(model.immutableViewSourceUrl).toBeNull();
  });

  it("keeps the read and completeness axes separate, as the contract does", () => {
    const model = projectEvent(contractEvent(), "impact");
    expect(model.read).toBe("ok");
    expect(model.completeness).toBe("not-established");
  });

  it("translates verified completeness into what it was verified against", () => {
    const event = contractEvent();
    event.datahub.lineageObservation.upstreams = {
      read: "ok",
      completeness: "verified",
      observedCount: 1,
      verification: {
        manifestDigest: "m", expectedSetDigest: "e", observedSetDigest: "e",
        queryParameters: { direction: "UPSTREAM" },
      },
    };
    expect(projectEvent(event, "impact").completeness).toBe("complete-against-pinned-manifest");
  });

  it("shows zero edges as a stated reason, never as an empty finding", () => {
    const event = contractEvent();
    event.datahub.upstreams = [];
    event.datahub.lineageObservation.upstreams = { read: "ok", completeness: "unverified", observedCount: 0 };
    event.unavailable = [{
      field: "datahub.upstreams", source: "datahub", reason: "indeterminate",
      detail: "The lineage index converges after ingestion, so this is not evidence that none exist.",
      completeness: "unverified", observedCount: 0,
    }];
    const [edge] = projectEvent(event, "impact").impactEdges;
    expect(edge?.state).toBe("unresolved");
    expect(edge?.reason).toMatch(/not evidence that none exist/);
  });

  it.each([
    ["repository-mismatch", "mismatch"],
    ["revision-mismatch", "mismatch"],
    ["path-ambiguous", "partial"],
    ["artifact-unavailable", "unavailable"],
    ["exact-match", "resolved"],
  ] as const)("maps artifact integrity %s to disposition %s", (integrity, expected) => {
    const event = contractEvent();
    event.provenance.workspaceArtifact = { ...event.provenance.workspaceArtifact!, integrity };
    expect(projectEvent(event, "impact").resolutionDisposition).toBe(expected);
  });

  it("claims no plan delta, because the event carries no plan", () => {
    // The DataHub-only/joined comparison is HAC-218's surface. Synthesising a
    // delta here would put an invented claim on the screen whose whole job is
    // showing a real one.
    expect(projectEvent(contractEvent(), "impact").planDeltas).toEqual([]);
  });
});
