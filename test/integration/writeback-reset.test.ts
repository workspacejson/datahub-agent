import { describe, expect, it } from "vitest";
import { EVIDENCE_TIER_PROPERTY_ID, LINK_LABEL } from "../../src/integration/writeback.js";
import {
  deriveResetDisposition,
  ownershipStatement,
  ownsAnything,
  planReset,
} from "../../src/integration/writeback-reset.js";

const URN = "urn:li:dataset:(urn:li:dataPlatform:dbt,jaffle_shop.main.customers,PROD)";

const state = (over: Partial<Parameters<typeof ownsAnything>[0]> = {}) => ({
  linkUrl: null,
  evidenceTier: null,
  read: "ok" as const,
  readError: null,
  ...over,
});

describe("what the reset owns", () => {
  it("names the same label and property id the writeback writes", () => {
    // The boundary is a shared constant, not two strings that happen to match.
    // A rename on one side that missed the other would leave the reset removing
    // nothing while reporting itself clean.
    expect(ownershipStatement()).toEqual({
      linkLabel: LINK_LABEL,
      structuredPropertyId: EVIDENCE_TIER_PROPERTY_ID,
    });
  });
});

describe("planning a reset", () => {
  it("issues nothing against an instance holding nothing owned", () => {
    // Removals that "succeed" against absent metadata would make a never-written
    // instance indistinguishable from one that was just cleaned.
    expect(planReset(URN, state())).toEqual([]);
  });

  it("removes the link at the exact url and label it wrote", () => {
    const plan = planReset(URN, state({ linkUrl: "https://example.test/blob/abc/models/customers.sql" }));
    expect(plan).toEqual([
      {
        mutation: "removeLink",
        variables: {
          input: {
            resourceUrn: URN,
            linkUrl: "https://example.test/blob/abc/models/customers.sql",
            label: LINK_LABEL,
          },
        },
      },
    ]);
  });

  it("sends the label as well as the url, so a foreign link at the same url survives", () => {
    const plan = planReset(URN, state({ linkUrl: "https://example.test/x" }));
    expect((plan[0]?.variables as { input: { label: string } }).input.label).toBe(LINK_LABEL);
  });

  it("removes only the one structured property it defines", () => {
    const plan = planReset(URN, state({ evidenceTier: "VERIFIED" }));
    expect(plan).toHaveLength(1);
    expect(plan[0]?.mutation).toBe("removeStructuredProperties");
    expect((plan[0]?.variables as { input: { structuredPropertyUrns: string[] } }).input.structuredPropertyUrns).toEqual([
      `urn:li:structuredProperty:${EVIDENCE_TIER_PROPERTY_ID}`,
    ]);
  });

  it("plans both removals when both are present", () => {
    const plan = planReset(URN, state({ linkUrl: "https://example.test/x", evidenceTier: "OBSERVED" }));
    expect(plan.map((step) => step.mutation)).toEqual(["removeLink", "removeStructuredProperties"]);
  });

  it("never names a field it does not own", () => {
    // The refusal this encodes: a reset with any reach into description,
    // editableProperties, tags, terms, ownership or domain. Those carry human
    // text or human decisions and this command has no vocabulary for them.
    const serialised = JSON.stringify(planReset(URN, state({ linkUrl: "https://example.test/x", evidenceTier: "VERIFIED" })));
    for (const forbidden of ["description", "editableProperties", "tags", "glossaryTerms", "ownership", "domain"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe("what a reset established", () => {
  it("reports cleared when owned state was present and is read back absent", () => {
    expect(
      deriveResetDisposition({
        before: state({ linkUrl: "https://example.test/x", evidenceTier: "VERIFIED" }),
        after: state(),
        attempts: [{ succeeded: true }, { succeeded: true }],
      }),
    ).toBe("cleared");
  });

  it("distinguishes an instance that was already clean from one it cleaned", () => {
    // Only one of these is evidence the removal path works.
    expect(deriveResetDisposition({ before: state(), after: state(), attempts: [] })).toBe("already-clean");
  });

  it("reports incomplete when the mutations were accepted but the state is still visible", () => {
    // Index lag, not a rejected write — and the operator's next move differs.
    expect(
      deriveResetDisposition({
        before: state({ evidenceTier: "VERIFIED" }),
        after: state({ evidenceTier: "VERIFIED" }),
        attempts: [{ succeeded: true }],
      }),
    ).toBe("incomplete");
  });

  it("reports failed when a mutation failed, whatever the after-state shows", () => {
    expect(
      deriveResetDisposition({
        before: state({ evidenceTier: "VERIFIED" }),
        after: state(),
        attempts: [{ succeeded: false }],
      }),
    ).toBe("failed");
  });

  it("claims nothing when the before-state could not be read", () => {
    // An unreadable instance cannot support "there was nothing to clear" any
    // more than it can support "it was cleared".
    expect(
      deriveResetDisposition({
        before: state({ read: "failed", readError: "connection refused" }),
        after: state(),
        attempts: [],
      }),
    ).toBe("failed");
  });

  it("claims nothing when the verifying read did not complete", () => {
    expect(
      deriveResetDisposition({
        before: state({ evidenceTier: "VERIFIED" }),
        after: state({ read: "failed", readError: "timeout" }),
        attempts: [{ succeeded: true }],
      }),
    ).toBe("failed");
  });
});

describe("ownership predicate", () => {
  it("is true for either owned field alone", () => {
    expect(ownsAnything(state({ linkUrl: "https://example.test/x" }))).toBe(true);
    expect(ownsAnything(state({ evidenceTier: "ASSERTED" }))).toBe(true);
  });

  it("is false only when both are absent", () => {
    expect(ownsAnything(state())).toBe(false);
  });
});
