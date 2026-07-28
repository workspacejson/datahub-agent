/**
 * The golden fixtures are real emitter output against a live DataHub, committed
 * so every judge-facing surface renders the same evidence without needing an
 * instance running. These tests are what stop them decaying into hand-edited
 * demo JSON: any drift from the contract, or any loss of the properties that
 * make them worth showing, fails here.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CHANGE_IMPACT_EVENT_VERSION,
  toDataHubOnly,
  validateEvent,
} from "../../src/integration/change-impact-event.js";
import { LINK_LABEL, type EnrichedChangeImpactEvent } from "../../src/integration/writeback.js";

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/golden");

const load = (name: string): EnrichedChangeImpactEvent =>
  JSON.parse(readFileSync(join(goldenDir, name), "utf8")) as EnrichedChangeImpactEvent;

const FIXTURES = {
  root: load("change-impact-event.root.json"),
  nested: load("change-impact-event.nested.json"),
} as const;

describe.each(Object.entries(FIXTURES))("golden fixture: %s", (_name, event) => {
  it("satisfies the frozen contract", () => {
    expect(validateEvent(event)).toEqual([]);
  });

  it("declares the contract version the consumers compile against", () => {
    expect(event.eventVersion).toBe(CHANGE_IMPACT_EVENT_VERSION);
  });

  it("carries provenance a reviewer can re-derive the result from", () => {
    expect(event.provenance.corpus.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(event.provenance.corpus.repository).toMatch(/^https:\/\//);
    expect(event.provenance.datahub.gmsVersion).toBeTruthy();
    expect(event.provenance.workspaceArtifact?.producedBy).toBe("@workspacejson/cli");
  });

  it("resolves the producing file to a repository-root-relative path", () => {
    expect(event.code.method).not.toBe("unresolved");
    expect(event.code.repositoryRelativePath).toBeTruthy();
    expect(event.code.repositoryRelativePath).not.toMatch(/^\/|^\.\/|\\/);
  });

  it("pins the source link to an immutable commit, not a branch", () => {
    expect(event.code.sourceUrl).toContain(`/blob/${event.provenance.corpus.commit}/`);
  });

  it("states every absence rather than leaving an empty collection unexplained", () => {
    for (const [collection, field] of [
      [event.datahub.upstreams, "datahub.upstreams"],
      [event.datahub.downstreams, "datahub.downstreams"],
      [event.partners, "partners"],
    ] as const) {
      if (collection.length === 0) {
        const entry = event.unavailable.find((u) => u.field === field);
        expect(entry, `${field} is empty but has no unavailable entry`).toBeDefined();
        expect(entry?.source).toMatch(/datahub|workspacejson/);
        expect(entry?.reason).toMatch(/absent|not-queried|failed|indeterminate/);
        expect(entry?.detail.length).toBeGreaterThan(0);
      }
    }
  });

  it("reduces to a DataHub-only view that still satisfies the contract", () => {
    expect(validateEvent(toDataHubOnly(event))).toEqual([]);
  });

  describe("the attached writeback receipt", () => {
    it("is present, so the fixture carries the write and not only the read", () => {
      expect(event.writeback).not.toBeNull();
    });

    it("records a write that succeeded without refusal", () => {
      expect(event.writeback?.refusedBecause).toBeNull();
      expect(event.writeback?.succeeded).toBe(true);
      expect(event.writeback?.attempts.every((a) => a.succeeded)).toBe(true);
    });

    it("observed both sides of the write, so the transition is evidence", () => {
      // Mutations returning cleanly against an instance that could not be read
      // is not a verified write. A fixture is only a demonstration if the
      // before and after states were actually observed.
      expect(event.writeback?.verified).toBe(true);
      expect(event.writeback?.before.read).toBe("ok");
      expect(event.writeback?.after.read).toBe("ok");
    });

    it("states what it was trying to write, not only what it sent", () => {
      // Without a recorded intent the receipt can only compare its two
      // observations to each other, and a before/after pair has no opinion
      // about whether either one is correct.
      expect(event.writeback?.intended).toEqual({
        linkUrl: event.code.sourceUrl,
        evidenceTier: event.evidence.tier,
      });
    });

    it("claims success against that intent rather than against the reads alone", () => {
      // The receipt's own claim, checked from inside the receipt. Previously
      // `succeeded` only meant "mutations returned and both reads completed",
      // which is true of a write that never became visible.
      const { intended, after, succeeded } = event.writeback!;
      expect(succeeded).toBe(true);
      expect(after.linkUrl).toBe(intended?.linkUrl);
      expect(after.evidenceTier).toBe(intended?.evidenceTier);
    });

    it("records how the after-state was reached, and that it settled", () => {
      // A write is observed to a bound, not read once, because DataHub serves
      // stale reads after a successful mutation. The bound is recorded so a
      // timeout could be read against it.
      expect(event.writeback?.observation?.status).toBe("settled");
      expect(event.writeback?.observation?.polls).toBeGreaterThanOrEqual(1);
      expect(event.writeback?.observation?.timeoutMs).toBeGreaterThan(0);
      expect(event.writeback?.observation?.lastError).toBeNull();
    });

    it("is a first enrichment run — this tool had written nothing before it", () => {
      // Precisely: a first enrichment run against a *bootstrapped* instance,
      // not a first run against a clean one. The catalog had been ingested and
      // used; what was reset before capture was only the link and the
      // structured-property value this tool owns. That is what the before-state
      // below asserts, and it is all it asserts.
      //
      // The distinction matters because re-running the writeback against an
      // already-enriched instance yields noop=true and before === after — a
      // correct result, but a misleading thing to commit as the demonstration.
      // Making the reset deterministic and verified is tracked under HAC-146.
      expect(event.writeback?.before).toEqual({
        linkUrl: null,
        evidenceTier: null,
        read: "ok",
        readError: null,
      });
      expect(event.writeback?.noop).toBe(false);
    });

    it("moved the dataset to the commit-pinned link and the derived tier", () => {
      expect(event.writeback?.after.linkUrl).toBe(event.code.sourceUrl);
      expect(event.writeback?.after.evidenceTier).toBe(event.evidence.tier);
    });

    it("targets the subject it was derived from, at the same revision", () => {
      expect(event.writeback?.targetUrn).toBe(event.subject.urn);
      expect(event.writeback?.revision.commit).toBe(event.provenance.corpus.commit);
    });

    it("attributes the write to a named actor and a timestamp", () => {
      expect(event.writeback?.actor.tool).toBeTruthy();
      expect(event.writeback?.attemptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("used only the two upsert mutations, both core OSS", () => {
      const mutations = event.writeback?.attempts.map((a) => a.mutation) ?? [];
      expect(mutations).toContain("upsertLink");
      expect(mutations).toContain("upsertStructuredProperties");
      expect(mutations.some((m) => /assertion/i.test(m))).toBe(false);
    });

    it("writes the link before the structured property, so the tier annotates an existing link", () => {
      // Conditional on mutations having been attempted, deliberately.
      //
      // Asserting `linkIdx >= 0` unconditionally passes only while the fixtures
      // carry a successful writeback. Under the MCP-only read path there is no
      // commit-pinned URL, the writeback refuses, and `attempts` is empty — so
      // the unconditional form would fail on the next re-emission for a reason
      // that has nothing to do with ordering.
      //
      // A refusal is a real outcome, not a missing one, so it is asserted as
      // such rather than skipped: if nothing was attempted, the receipt must say
      // why.
      const mutations = event.writeback?.attempts.map((a) => a.mutation) ?? [];
      if (mutations.length === 0) {
        expect(event.writeback?.refusedBecause ?? null).not.toBeNull();
        return;
      }
      const linkIdx = mutations.indexOf("upsertLink");
      const propIdx = mutations.indexOf("upsertStructuredProperties");
      expect(linkIdx).toBeGreaterThanOrEqual(0);
      expect(propIdx).toBeGreaterThan(linkIdx);
    });

    it("wrote nothing human-authored, as recorded in the attempts themselves", () => {
      // The plan-level test asserts the same policy. This asserts it against
      // what was actually sent to a live catalog.
      const sent = JSON.stringify(event.writeback?.attempts.map((a) => a.variables));
      expect(sent).not.toMatch(/editableProperties|"description"/i);
      expect(sent).not.toMatch(/fragility|riskScore/i);
    });

    it("carries no credential, since the fixture is committed", () => {
      const receipt = JSON.stringify(event.writeback);
      expect(receipt).not.toMatch(/"(token|password|secret|authorization)":\s*"(?!\[redacted\])/i);
    });

    it("labels the link so a re-run upserts the same one", () => {
      const linkAttempt = event.writeback?.attempts.find((a) => a.mutation === "upsertLink");
      expect((linkAttempt?.variables.input as { label?: string })?.label).toBe(LINK_LABEL);
    });
  });
});

describe("the fixtures cover both project layouts", () => {
  it("the root-level fixture has an empty prefix", () => {
    expect(FIXTURES.root.code.projectPrefix).toBe("");
    expect(FIXTURES.root.code.repositoryRelativePath).toBe(FIXTURES.root.code.dbtFilePath);
  });

  it("the nested fixture has a real prefix, and the paths differ by exactly it", () => {
    // This is the case a root-level-only fixture cannot exercise, and the one
    // where a naive join silently returns nothing.
    const { projectPrefix, dbtFilePath, repositoryRelativePath } = FIXTURES.nested.code;
    expect(projectPrefix).toBe("dbt");
    expect(repositoryRelativePath).toBe(`${projectPrefix}/${dbtFilePath}`);
    expect(repositoryRelativePath).not.toBe(dbtFilePath);
  });

  it("both were resolved from the catalog rather than an out-of-band manifest read", () => {
    // Recorded because it is the load-bearing claim: the prefix was derived
    // from what DataHub itself exposed, not from configuration we supplied.
    expect(FIXTURES.root.code.method).toBe("external-url");
    expect(FIXTURES.nested.code.method).toBe("external-url");
  });
});
