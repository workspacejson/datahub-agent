/**
 * The writeback is the only part of this project that *changes* a catalog other
 * people trust. Two classes of test matter here, and they are different things:
 *
 * - What the plan does — the mutations, their shape, their idempotency.
 * - What the plan must never do. The standing rules (no invented score, never
 *   touch human-authored fields) are policy, and policy that is only written
 *   down erodes. These assert it against the emitted plan, so a future change
 *   that quietly adds a description write fails here rather than in a catalog.
 */

import { describe, expect, it } from "vitest";

import {
  CHANGE_IMPACT_EVENT_VERSION,
  validateEvent,
  type ChangeImpactEvent,
  type EvidenceTier,
} from "../../src/integration/change-impact-event.js";
import {
  EVIDENCE_TIER_PROPERTY_ID,
  LINK_LABEL,
  attachReceipt,
  isNoop,
  planWriteback,
  redact,
  refusalReason,
  unreadableState,
  type CatalogState,
  type WritebackReceipt,
} from "../../src/integration/writeback.js";

const COMMIT = "59fa295c51fc23466f3a71542f8bf3d1335daa83";
const URN = "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)";
const SOURCE_URL = `https://github.com/dcaribou/transfermarkt-datasets/blob/${COMMIT}/dbt/models/curated/game_events.sql`;

/** An event a writeback can proceed from — every test mutates one thing from here. */
function resolvedEvent(overrides: Partial<ChangeImpactEvent> = {}): ChangeImpactEvent {
  return {
    eventVersion: CHANGE_IMPACT_EVENT_VERSION,
    provenance: {
      producedAt: "2026-07-27T00:00:00.000Z",
      producer: { name: "@workspacejson/datahub-agent", version: "0.0.1" },
      datahub: { gmsUrl: "http://localhost:8080", gmsVersion: "v1.5.0.6" },
      corpus: { repository: "https://github.com/dcaribou/transfermarkt-datasets", commit: COMMIT },
      workspaceArtifact: { producedBy: "@workspacejson/cli", fileIndexKeys: 36 },
    },
    subject: { urn: URN },
    datahub: {
      name: "game_events",
      platform: "dbt",
      description: "a human wrote this and the writeback must never touch it",
      upstreams: [
        { urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.games,PROD)", name: "games", degree: 1 },
      ],
      downstreams: [
        { urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.appearances,PROD)", name: "appearances", degree: 1 },
      ],
      schemaFieldCount: 12,
      owners: [],
      domain: null,
    },
    code: {
      dbtUniqueId: "model.transfermarkt_datasets.game_events",
      dbtFilePath: "models/curated/game_events.sql",
      repositoryRelativePath: "dbt/models/curated/game_events.sql",
      projectPrefix: "dbt",
      method: "external-url",
      sourceUrl: SOURCE_URL,
    },
    partners: [],
    evidence: {
      records: [
        {
          claim: "the producing file is addressable at an immutable commit",
          observation: SOURCE_URL,
          source: "datahub",
          verified: true,
        },
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
    unavailable: [
      {
        field: "partners",
        source: "workspacejson",
        reason: "absent",
        detail: "the artifact carries file-index keys but no behavioral co-change values",
      },
    ],
    ...overrides,
  };
}

describe("refusalReason", () => {
  it("permits a resolved, commit-pinned event", () => {
    expect(refusalReason(resolvedEvent())).toBeNull();
  });

  it("refuses when the producing file was never resolved", () => {
    const event = resolvedEvent();
    event.code.method = "unresolved";
    event.code.repositoryRelativePath = null;
    expect(refusalReason(event)).toMatch(/could not be resolved/);
  });

  it("refuses an unpinned link rather than writing one that drifts", () => {
    // A branch-relative URL would silently start pointing at different content
    // than the artifact describes. Refusing is the honest outcome.
    const event = resolvedEvent();
    event.code.sourceUrl = null;
    expect(refusalReason(event)).toMatch(/commit-pinned/);
  });

  it("refuses when the enrichment could not be attributed to a commit", () => {
    const event = resolvedEvent();
    event.provenance.corpus.commit = null;
    expect(refusalReason(event)).toMatch(/revision is unknown/);
  });

  it("names the cause in prose rather than returning a bare boolean", () => {
    // The receipt shows this string to a reviewer. A boolean would produce a
    // silent skip, which is the failure mode the receipt exists to prevent.
    const event = resolvedEvent();
    event.code.sourceUrl = null;
    const reason = refusalReason(event);
    expect(typeof reason).toBe("string");
    expect((reason as string).length).toBeGreaterThan(20);
  });
});

describe("planWriteback", () => {
  it("issues exactly two mutations: the link, then the tier", () => {
    expect(planWriteback(resolvedEvent()).map((s) => s.mutation)).toEqual([
      "upsertLink",
      "upsertStructuredProperties",
    ]);
  });

  it("uses only mutations available on OSS quickstart", () => {
    // Assertion-based writeback is Cloud-gated, so a judge running the demo
    // against quickstart would hit a wall. Neither of these is gated.
    const mutations = planWriteback(resolvedEvent()).map((s) => s.mutation);
    expect(mutations).not.toContain("createAssertion");
    expect(mutations.every((m) => m.startsWith("upsert"))).toBe(true);
  });

  it("writes the commit-pinned URL under the label this tool owns", () => {
    const [link] = planWriteback(resolvedEvent());
    expect(link?.variables).toEqual({
      input: { resourceUrn: URN, linkUrl: SOURCE_URL, label: LINK_LABEL },
    });
    expect(SOURCE_URL).toContain(`/blob/${COMMIT}/`);
  });

  it("labels the link consistently, so a re-run upserts rather than duplicates", () => {
    // upsertLink matches on the (url, label) pair. A label that varied per run
    // would accumulate near-identical links on the dataset.
    const first = planWriteback(resolvedEvent());
    const second = planWriteback(resolvedEvent());
    expect(first).toEqual(second);
    expect(first[0]?.variables).toMatchObject({ input: { label: LINK_LABEL } });
  });

  it("targets the event's own subject in every mutation", () => {
    const targets = planWriteback(resolvedEvent()).map((s) => {
      const input = s.variables.input as Record<string, unknown>;
      return input.resourceUrn ?? input.assetUrn;
    });
    expect(targets).toEqual([URN, URN]);
  });

  it.each<EvidenceTier>(["ASSERTED", "OBSERVED", "VERIFIED"])(
    "carries the mechanically derived tier %s through unchanged",
    (tier) => {
      const event = resolvedEvent();
      event.evidence.tier = tier;
      const [, property] = planWriteback(event);
      const input = property?.variables.input as {
        structuredPropertyInputParams: Array<{ structuredPropertyUrn: string; values: unknown[] }>;
      };
      expect(input.structuredPropertyInputParams[0]?.values).toEqual([{ stringValue: tier }]);
      expect(input.structuredPropertyInputParams[0]?.structuredPropertyUrn).toBe(
        `urn:li:structuredProperty:${EVIDENCE_TIER_PROPERTY_ID}`,
      );
    },
  );

  it("plans nothing when there is no source URL to write", () => {
    const event = resolvedEvent();
    event.code.sourceUrl = null;
    expect(planWriteback(event)).toEqual([]);
  });

  it("is pure — planning does not mutate the event it reads", () => {
    const event = resolvedEvent();
    const before = JSON.stringify(event);
    planWriteback(event);
    expect(JSON.stringify(event)).toBe(before);
  });
});

describe("planWriteback refuses to write the things policy forbids", () => {
  /** The whole plan as one string, so a forbidden field cannot hide in nesting. */
  const serializedPlan = (event = resolvedEvent()): string => JSON.stringify(planWriteback(event));

  it("never writes a risk or fragility score", () => {
    // No defensible per-file measurement exists. Publishing one into a catalog
    // other people trust would be the least honest option available.
    expect(serializedPlan()).not.toMatch(/fragility|risk|score|severity|confidence/i);
  });

  it("never touches description or editableProperties", () => {
    // Those carry human text. A tool that overwrites them destroys evidence it
    // did not create — even though the event itself carries a description.
    const plan = serializedPlan();
    expect(plan).not.toMatch(/description|editableProperties/i);
    expect(resolvedEvent().datahub.description).toBeTruthy();
  });

  it("never writes ownership, tags, or glossary terms it did not establish", () => {
    expect(serializedPlan()).not.toMatch(/owner|globalTags|glossaryTerms|domain/i);
  });

  it("writes exactly one link and one property, and nothing else", () => {
    // A bounded blast radius is the claim. This fails if the plan grows a step.
    expect(planWriteback(resolvedEvent())).toHaveLength(2);
  });
});

describe("redact", () => {
  it("masks a token wherever it is nested", () => {
    const out = redact({ input: { auth: { token: "secret-value" } } });
    expect(JSON.stringify(out)).not.toContain("secret-value");
    expect((out.input as { auth: { token: string } }).auth.token).toBe("[redacted]");
  });

  it.each(["token", "Authorization", "SECRET", "password"])(
    "masks %s regardless of case",
    (key) => {
      expect(redact({ [key]: "sensitive" })[key]).toBe("[redacted]");
    },
  );

  it("reaches into arrays, which is where the property params live", () => {
    const out = redact({ params: [{ ok: "keep" }, { token: "sensitive" }] });
    const params = out.params as Array<Record<string, string>>;
    expect(params[0]?.ok).toBe("keep");
    expect(params[1]?.token).toBe("[redacted]");
  });

  it("leaves everything else byte-identical", () => {
    const plan = planWriteback(resolvedEvent());
    expect(redact(plan[0]!.variables)).toEqual(plan[0]!.variables);
  });

  it("does not mutate its input, so the redacted copy cannot corrupt the send", () => {
    // run-writeback sends the real variables and stores the redacted clone. If
    // redact mutated in place, the order of those two would decide correctness.
    const variables = { input: { token: "secret-value" } };
    redact(variables);
    expect(variables.input.token).toBe("secret-value");
  });
});

/** A state the catalog actually answered for. */
const readState = (
  linkUrl: string | null,
  evidenceTier: CatalogState["evidenceTier"] = null,
): CatalogState => ({ linkUrl, evidenceTier, read: "ok", readError: null });

describe("unreadableState", () => {
  it("carries the failure rather than presenting nulls as an answer", () => {
    const state = unreadableState("TypeError: fetch failed");
    expect(state.read).toBe("failed");
    expect(state.readError).toBe("TypeError: fetch failed");
    expect(state.linkUrl).toBeNull();
  });
});

describe("isNoop", () => {
  it("is true when the state already matched and both sides were read", () => {
    expect(isNoop(readState(SOURCE_URL, "VERIFIED"), readState(SOURCE_URL, "VERIFIED"))).toBe(true);
  });

  it("is false when the link was absent before, which is a real write", () => {
    expect(isNoop(readState(null), readState(SOURCE_URL, "VERIFIED"))).toBe(false);
  });

  it("is false when the tier changed even though the link did not", () => {
    expect(isNoop(readState(SOURCE_URL, "OBSERVED"), readState(SOURCE_URL, "VERIFIED"))).toBe(false);
  });

  it.each([
    ["the before state", unreadableState("boom"), readState(SOURCE_URL, "VERIFIED")],
    ["the after state", readState(SOURCE_URL, "VERIFIED"), unreadableState("boom")],
    ["both states", unreadableState("boom"), unreadableState("boom")],
  ])("is never true when %s could not be read", (_label, before, after) => {
    // "nothing changed" and "we could not tell whether anything changed" are
    // different claims, and only the first is evidence of idempotency. Two
    // unreadable states are equal to each other, which is exactly the trap.
    expect(isNoop(before, after)).toBe(false);
  });
});

describe("attachReceipt", () => {
  const receipt = (overrides: Partial<WritebackReceipt> = {}): WritebackReceipt => ({
    targetUrn: URN,
    actor: { tool: "@workspacejson/datahub-agent", version: "0.0.1" },
    attemptedAt: "2026-07-27T00:00:00.000Z",
    revision: { repository: "https://github.com/dcaribou/transfermarkt-datasets", commit: COMMIT },
    before: readState(null),
    after: readState(SOURCE_URL, "VERIFIED"),
    attempts: [
      { mutation: "upsertLink", variables: {}, succeeded: true, response: "true" },
    ],
    succeeded: true,
    noop: false,
    verified: true,
    refusedBecause: null,
    ...overrides,
  });

  it("folds the receipt into the event as a single artifact", () => {
    expect(attachReceipt(resolvedEvent(), receipt()).writeback?.after.linkUrl).toBe(SOURCE_URL);
  });

  it("keeps an absent receipt as an explicit null rather than dropping the key", () => {
    // A missing key reads as "this consumer is old". An explicit null reads as
    // "no writeback was attempted". They are different facts.
    const enriched = attachReceipt(resolvedEvent(), null);
    expect(enriched.writeback).toBeNull();
    expect(Object.hasOwn(enriched, "writeback")).toBe(true);
  });

  it("does not mutate the event it enriches", () => {
    const event = resolvedEvent();
    attachReceipt(event, receipt());
    expect(Object.hasOwn(event, "writeback")).toBe(false);
  });

  it("produces an event that still satisfies the frozen contract", () => {
    // The golden fixtures are enriched events. If attaching a receipt broke
    // validation, every judge-facing fixture would be invalid.
    expect(validateEvent(attachReceipt(resolvedEvent(), receipt()))).toEqual([]);
  });

  it("carries a failed receipt just as readily as a successful one", () => {
    // A writeback that fails silently is worse than one that fails loudly.
    const failed = attachReceipt(
      resolvedEvent(),
      receipt({
        succeeded: false,
        after: readState(null),
        attempts: [
          { mutation: "upsertLink", variables: {}, succeeded: false, response: "connection refused" },
        ],
      }),
    );
    expect(failed.writeback?.succeeded).toBe(false);
    expect(failed.writeback?.attempts[0]?.response).toBe("connection refused");
  });

  it("carries an unreachable instance as unreadable, not as an empty catalog", () => {
    // The whole failure mode: a receipt showing before=absent, after=absent on
    // an instance that was never reached would look like a clean, honest write
    // that simply did nothing. `read: "failed"` is what stops that reading.
    const unreachable = attachReceipt(
      resolvedEvent(),
      receipt({
        succeeded: false,
        verified: false,
        before: unreadableState("TypeError: fetch failed"),
        after: unreadableState("TypeError: fetch failed"),
        attempts: [
          { mutation: "upsertLink", variables: {}, succeeded: false, response: "TypeError: fetch failed" },
        ],
      }),
    );
    expect(unreachable.writeback?.before.read).toBe("failed");
    expect(unreachable.writeback?.verified).toBe(false);
    expect(unreachable.writeback?.noop).toBe(false);
  });

  it("records a refusal with its reason instead of an empty attempt list", () => {
    const refused = attachReceipt(
      resolvedEvent(),
      receipt({
        succeeded: false,
        attempts: [],
        after: readState(null),
        refusedBecause: "no commit-pinned source URL is available",
      }),
    );
    expect(refused.writeback?.refusedBecause).toMatch(/commit-pinned/);
    expect(refused.writeback?.attempts).toEqual([]);
  });
});
