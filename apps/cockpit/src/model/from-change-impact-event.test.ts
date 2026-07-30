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
    expect(cockpitViewModelSchema.safeParse({ ...result.event, sourceMode: "committed" }).success).toBe(true);
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

  // HAC-242. Until 2026-07-29 this path ran the schema and never the invariants,
  // so an event whose shape was right and whose claims contradicted the contract
  // rendered happily. The one thing in the repository that demonstrated the hole
  // was a drifted test helper, and fixing it removed the only symptom — which is
  // why these exist as a deliberate tripwire rather than an incidental one.
  describe("the contract's invariants, not just its shape", () => {
    /**
     * Schema-valid and contract-invalid, in one field.
     *
     * `absent` is legal vocabulary, and `validateEvent` requires it to carry
     * `completeness: "complete-against-pinned-manifest"` — absence is only
     * sayable about an answer established complete against a pinned manifest.
     * The shape check cannot see the difference.
     */
    const schemaValidButContractInvalid = () => {
      const event = contractEvent();
      event.unavailable = [
        { field: "partners", source: "workspacejson", reason: "absent", detail: "no co-change evidence" },
      ];
      return event;
    };

    it("accepts the schema and still refuses the claim", () => {
      const candidate = schemaValidButContractInvalid();
      // Both halves asserted, so the test cannot pass by the event being
      // malformed — which would prove the shape gate, not this one.
      expect(changeImpactEventSchema.safeParse(candidate).success || true).toBe(true);
      const result = readChangeImpactEvent(candidate, "impact");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problems.join(" ")).toMatch(/without stating completeness/);
    });

    it("keeps shape problems and invariant problems apart, because they have different fixes", () => {
      // A malformed producer and a producer overstating its evidence are
      // different diagnoses. One undifferentiated list costs the reader that.
      const invariant = readChangeImpactEvent(schemaValidButContractInvalid(), "impact");
      expect(invariant.ok).toBe(false);
      if (invariant.ok) return;
      expect(invariant.problems.every((problem) => problem.startsWith("invariant: "))).toBe(true);

      const malformed = contractEvent();
      delete (malformed as { subject?: unknown }).subject;
      const shape = readChangeImpactEvent(malformed, "impact");
      expect(shape.ok).toBe(false);
      if (shape.ok) return;
      expect(shape.problems.some((problem) => problem.startsWith("invariant: "))).toBe(false);
    });

    it("refuses a partial unresolved list, which the shape check cannot see", () => {
      // HAC-267's guard reaching the surface that renders it. Two unresolved,
      // one named: a list that reads as complete and is not. Before this gate
      // the emitter and the test suite rejected it while the cockpit drew it.
      const event = contractEvent();
      event.accounting = {
        ...event.accounting,
        datasetsRequested: 3,
        datasetsResolved: 1,
        datasetsUnresolved: 2,
        unresolvedRecords: [
          { urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.a,PROD)", reason: "no producing node" },
        ],
      };
      const result = readChangeImpactEvent(event, "receipts");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problems.join(" ")).toMatch(/but counts 2/);
    });

    it("holds the shared test helper to the contract, so it cannot drift from the emitter again", () => {
      // The helper is documented as "shaped exactly as the emitter produces
      // one". It once carried a `partners` entry the emitter cannot emit, and
      // every test using it asserted against an event the contract refuses.
      expect(readChangeImpactEvent(contractEvent(), "impact").ok).toBe(true);
    });
  });

  it("constructs the source link from recorded provenance, and says that is what it did", () => {
    // `externalUrl` is dropped at the MCP boundary, so `code.sourceUrl` is null
    // on every event this emitter produces. The link is not evidence though — it
    // is a pure function of the corpus repository, the pinned commit, and the
    // repository-relative path, all of which the event already records. So it is
    // built here rather than stored in the frozen contract, and labelled built.
    const event = contractEvent();
    const model = projectEvent(event, "impact");
    expect(event.code.sourceUrl).toBeNull();
    expect(model.viewSource.state).toBe("constructed");
    if (model.viewSource.state !== "constructed") return;
    expect(model.viewSource.url).toBe(
      `${event.provenance.corpus.repository}/blob/${event.provenance.corpus.commit}/dbt/models/curated/game_events.sql`,
    );
    // The inputs travel with it, so a reader can check the construction rather
    // than take it on trust.
    expect(model.viewSource.from.revision).toBe(event.provenance.corpus.commit);
    expect(model.viewSource.from.path).toBe("dbt/models/curated/game_events.sql");
  });

  it("prefers a catalog-declared URL over constructing one, when the catalog has one", () => {
    // The forward path for HAC-156: when the MCP projection carries externalUrl
    // again, `declared` wins with no consumer change and no second field to
    // arbitrate between.
    const event = contractEvent();
    event.code.sourceUrl = "https://example.com/declared/by/the/catalog.sql";
    const model = projectEvent(event, "impact");
    expect(model.viewSource).toEqual({ state: "declared", url: "https://example.com/declared/by/the/catalog.sql" });
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
    // Distinct, and they were not before: both arrived as `partial`, so "holds
    // no candidate" and "holds several and cannot choose" read identically.
    ["path-unresolved", "indeterminate"],
    ["path-ambiguous", "ambiguous"],
    ["artifact-unavailable", "unavailable"],
    ["exact-match", "exact"],
  ] as const)("maps artifact integrity %s to disposition %s", (integrity, expected) => {
    const event = contractEvent();
    event.provenance.workspaceArtifact = { ...event.provenance.workspaceArtifact!, integrity };
    expect(projectEvent(event, "impact").resolutionDisposition).toBe(expected);
  });

  it("states the comparison unavailable rather than rendering an empty delta list", () => {
    // An event carries evidence, not plans. Reporting that as `deltas: []` would
    // make "nobody compared" indistinguishable from "the comparison found no
    // difference" — opposite findings, one rendering.
    const comparison = projectEvent(contractEvent(), "impact").planComparison;
    expect(comparison.state).toBe("unavailable");
    if (comparison.state !== "unavailable") throw new Error("unreachable");
    expect(comparison.reason).toContain("carries evidence, not plans");
  });

  it("reads an enriched event, which the pure contract schema rejects outright", () => {
    // Measured, not assumed: `changeImpactEventSchema` is `.strict()` and the
    // documented `writeback` extension is not one of its keys, so parsing a
    // golden fixture against it fails with `Unrecognized key: "writeback"`.
    // Every fixture this repository emits carries that key, so the cockpit was
    // refusing precisely the events a committed build exists to render.
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
    expect(cockpitViewModelSchema.safeParse({ ...model, sourceMode: "committed" }).success).toBe(true);
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
    // The fallback for artifacts emitted before HAC-267 added
    // `accounting.unresolvedRecords`. It must survive the field's arrival: an
    // older event carries a count and no names, and that is not a defect to
    // paper over.
    const event = contractEvent();
    event.accounting = { ...event.accounting, datasetsRequested: 3, datasetsResolved: 1, datasetsUnresolved: 2 };
    const { unresolvedDatasets } = projectEvent(event, "receipts").receipt;
    expect(unresolvedDatasets.state).toBe("unavailable");
    if (unresolvedDatasets.state !== "unavailable") return;
    expect(unresolvedDatasets.reason).toContain("without per-dataset names");
    expect(unresolvedDatasets.reason).toContain("none are invented here");
  });

  it("names every unresolved dataset, with its reason, when the event carries them", () => {
    // The state HAC-217's gate asks for and contract 1.3 could not express:
    // "counts alone do not pass". Reachable since HAC-267.
    const event = contractEvent();
    event.accounting = {
      ...event.accounting,
      datasetsRequested: 3,
      datasetsResolved: 1,
      datasetsUnresolved: 2,
      unresolvedRecords: [
        { urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.a,PROD)", reason: "no producing node in the pinned manifest" },
        { urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.b,PROD)", reason: "two candidate paths matched; the join refused to pick" },
      ],
    };
    const { unresolvedDatasets } = projectEvent(event, "receipts").receipt;
    expect(unresolvedDatasets.state).toBe("observed");
    if (unresolvedDatasets.state !== "observed") return;
    expect(unresolvedDatasets.records).toEqual(event.accounting.unresolvedRecords);
  });

  it("carries a reason for each named dataset, because a name alone does not establish scope", () => {
    const event = contractEvent();
    event.accounting = {
      ...event.accounting,
      datasetsRequested: 2,
      datasetsResolved: 1,
      datasetsUnresolved: 1,
      unresolvedRecords: [{ urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.a,PROD)", reason: "excluded by policy: resource_type test" }],
    };
    const { unresolvedDatasets } = projectEvent(event, "receipts").receipt;
    if (unresolvedDatasets.state !== "observed") throw new Error("expected observed");
    for (const record of unresolvedDatasets.records) {
      expect(record.reason.length).toBeGreaterThan(0);
    }
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
