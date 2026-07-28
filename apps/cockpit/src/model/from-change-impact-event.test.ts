import { describe, expect, it } from "vitest";

import { changeImpactEventSchema } from "@contract";

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
      completeness: "complete-against-pinned-manifest",
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
    event.datahub.lineageObservation.upstreams = { read: "ok", completeness: "not-established", observedCount: 0 };
    event.unavailable = [{
      field: "datahub.upstreams", source: "datahub", reason: "indeterminate",
      detail: "The lineage index converges after ingestion, so this is not evidence that none exist.",
      completeness: "not-established", observedCount: 0,
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

  it("reads an enriched event, which the pure contract schema rejects outright", () => {
    // Measured, not assumed: `changeImpactEventSchema` is `.strict()` and the
    // documented `writeback` extension is not one of its keys, so parsing a
    // golden fixture against it fails with `Unrecognized key: "writeback"`.
    // Every fixture this repository emits carries that key, so the cockpit was
    // refusing precisely the events a fixture or live build exists to render.
    expect(changeImpactEventSchema.safeParse({ ...contractEvent(), writeback: { succeeded: true } }).success).toBe(false);
    expect(readChangeImpactEvent({ ...contractEvent(), writeback: { succeeded: true } }, "receipts").ok).toBe(true);
  });
});

describe("the receipt projection", () => {
  it("is produced for every event, so the receipts surface is never undefined", () => {
    // R-1. The integration defect this replaced: the view model required
    // `receipt` and the projection did not produce one, so a real event either
    // failed to compile or failed to parse — and the surface the whole
    // submission rests on rendered nothing.
    const model = projectEvent(contractEvent(), "receipts");
    expect(model.receipt).toBeDefined();
    expect(cockpitViewModelSchema.safeParse({ ...model, sourceMode: "fixture" }).success).toBe(true);
  });

  it("uses the contract's accounting vocabulary verbatim, with no synthesised total", () => {
    // R-3. Datasets and dbt nodes are separate denominators. The previous shape
    // required `total = kept + dropped + excluded + unresolved`, which sums the
    // two — an equation no real event satisfies without a fabricated number.
    const event = contractEvent();
    const { accounting } = projectEvent(event, "receipts").receipt;
    expect(accounting).toEqual({
      datasetsRequested: event.accounting.datasetsRequested,
      datasetsResolved: event.accounting.datasetsResolved,
      datasetsUnresolved: event.accounting.datasetsUnresolved,
      nodesDropped: event.accounting.nodesDropped,
      nodesExcluded: event.accounting.nodesExcluded,
    });
    expect(accounting).not.toHaveProperty("total");
    expect(accounting.datasetsResolved + accounting.datasetsUnresolved).toBe(accounting.datasetsRequested);
  });

  it("states the absence of unresolved names rather than inventing them", () => {
    const event = contractEvent();
    event.accounting = { ...event.accounting, datasetsRequested: 3, datasetsResolved: 1, datasetsUnresolved: 2 };
    const { unresolvedDatasets } = projectEvent(event, "receipts").receipt;
    expect(unresolvedDatasets.state).toBe("unavailable");
    if (unresolvedDatasets.state !== "unavailable") return;
    expect(unresolvedDatasets.reason).toContain("does not carry per-dataset names");
  });

  it("reports a null source URL as unavailable with a reason, never as a URL", () => {
    // R-2. The receipt reintroduced `z.string().url()` one level below the view
    // model, so the fix on the top-level field would have been undone here.
    const { immutableSourceUrl } = projectEvent(contractEvent(), "receipts").receipt.provenance;
    expect(immutableSourceUrl.state).toBe("unavailable");
    if (immutableSourceUrl.state !== "unavailable") return;
    expect(immutableSourceUrl.reason).toContain("externalUrl");
    expect(immutableSourceUrl).not.toHaveProperty("value");
  });

  it("carries a commit-pinned URL as an observation when the catalog exposes one", () => {
    const event = contractEvent();
    event.code = { ...event.code, sourceUrl: "https://github.com/example/repo/blob/abc123/models/x.sql" };
    const { immutableSourceUrl } = projectEvent(event, "receipts").receipt.provenance;
    expect(immutableSourceUrl).toEqual({
      state: "observed",
      value: "https://github.com/example/repo/blob/abc123/models/x.sql",
      source: "DataHub",
    });
  });

  it("states digest absence rather than filling in a plausible hash", () => {
    // Digests live on the contract's `VerificationEvidence`, attached only to a
    // completeness claim it can back. An unverified read has none.
    const { inputDigest, artifactDigest } = projectEvent(contractEvent(), "receipts").receipt.provenance;
    for (const value of [inputDigest, artifactDigest]) {
      expect(value.state).toBe("unavailable");
      if (value.state !== "unavailable") continue;
      expect(value.reason).toContain("no attestation digests");
    }
  });

  it("does not claim a writeback the cockpit has not read", () => {
    const { writeback } = projectEvent(contractEvent(), "receipts").receipt;
    expect(writeback.mutationResponse).toBe("not-attempted");
    expect(writeback.intendedStateObservation).toBe("not-attempted");
    expect(writeback.terminalDisposition).toBe("not-applicable");
    expect(writeback.bothStatesRead).toBe(false);
    expect(writeback.intent.state).toBe("unavailable");
  });

  it("projects no placeholder value from a real event", () => {
    // R-4, from the producing side. The boundary refuses placeholder evidence
    // outside a placeholder build; this asserts the projection never creates
    // any, so that refusal is not the only thing standing between an invented
    // value and a judge.
    const receipt = projectEvent(contractEvent(), "receipts").receipt;
    const states = JSON.stringify(receipt).match(/"state":"(\w+)"/g) ?? [];
    expect(states).not.toContain("\"state\":\"placeholder\"");
  });

  it("pairs every stated gap with the item the state strip shows", () => {
    const model = projectEvent(contractEvent(), "receipts");
    expect(model.receipt.statedGaps.map((gap) => `${gap.field}: ${gap.reason}`)).toEqual(model.unresolvedItems);
  });
});
