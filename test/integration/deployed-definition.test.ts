/**
 * The deployed structured-property definition, and the lattice it must state.
 *
 * A tier token is not self-describing. `VERIFIED` in a catalog means whatever
 * that catalog's property definition says it means, and this tool writes tier
 * values into a catalog it does not own. So there are two artifacts that have
 * to agree — the derivation in this package, and the definition deployed on the
 * instance — and until HAC-270's closure nothing compared them. The runner
 * reported `already exists` as success, which is the precise shape of the
 * defect: a catalog whose definition contradicted the code was indistinguishable
 * from one that matched, and the receipt claimed the contract was deployed in
 * both cases.
 *
 * These tests are the comparison. They are deliberately unit-level and take no
 * live catalog, because a check that only runs against a quickstart is a check
 * nobody runs.
 */

import { describe, expect, it } from "vitest";

import {
  EVIDENCE_TIER_LATTICE,
  deriveTier,
  type EvidenceRecord,
} from "../../src/integration/change-impact-event.js";
import {
  EVIDENCE_TIER_PROPERTY_DEFINITION,
  reconcileDeployedDefinition,
  type DeployedPropertyDefinition,
} from "../../src/integration/writeback.js";

const record = (checkExecuted: boolean): EvidenceRecord => ({
  claim: "c",
  observation: "o",
  source: "datahub",
  checkExecuted,
});

/** The four input classes of the frozen truth table, named as the issue names them. */
const CLASSES: ReadonlyArray<{ label: string; records: EvidenceRecord[] }> = [
  { label: "zero records", records: [] },
  { label: "one record, unexecuted", records: [record(false)] },
  { label: "mixed records", records: [record(false), record(true)] },
  { label: "all executed", records: [record(true), record(true)] },
];

/** A deployment that agrees, built from the requirement rather than retyped. */
const matching = (): DeployedPropertyDefinition => ({
  displayName: EVIDENCE_TIER_PROPERTY_DEFINITION.displayName,
  description: EVIDENCE_TIER_PROPERTY_DEFINITION.description,
  cardinality: EVIDENCE_TIER_PROPERTY_DEFINITION.cardinality,
  valueTypeUrn: EVIDENCE_TIER_PROPERTY_DEFINITION.valueTypeUrn,
  entityTypeUrns: [...EVIDENCE_TIER_PROPERTY_DEFINITION.entityTypeUrns],
  allowedValues: EVIDENCE_TIER_PROPERTY_DEFINITION.allowedValues.map((v) => ({ ...v })),
});

describe("the lattice states what the derivation does", () => {
  // The rules are prose consumed by a catalog definition, so they are exactly
  // the kind of text that goes on reading plausibly after it stops being true.
  // `holds` makes each one checkable against the frozen derivation.
  it.each(CLASSES)("selects exactly one tier for $label", ({ records }) => {
    const selected = EVIDENCE_TIER_LATTICE.filter((row) => row.holds(records));
    expect(selected).toHaveLength(1);
    expect(selected[0]!.tier).toBe(deriveTier(records));
  });

  it("covers every tier the derivation can return, and no others", () => {
    const stated = EVIDENCE_TIER_LATTICE.map((row) => row.tier).sort();
    const reachable = [...new Set(CLASSES.map(({ records }) => deriveTier(records)))].sort();
    expect(stated).toEqual(reachable);
  });

  it("gives the deployed definition its sentences, rather than a second copy of them", () => {
    for (const { tier, rule } of EVIDENCE_TIER_LATTICE) {
      const allowed = EVIDENCE_TIER_PROPERTY_DEFINITION.allowedValues.find(
        (v) => v.stringValue === tier,
      );
      expect(allowed?.description).toBe(rule);
      expect(EVIDENCE_TIER_PROPERTY_DEFINITION.description).toContain(`${tier}: ${rule}.`);
    }
  });
});

describe("reconciling the deployed definition", () => {
  it("passes a definition that matches, however it came to exist", () => {
    // Freshly created and previously present are the same question at this
    // point: what does the catalog now hold? The mutation's own report is not
    // evidence of that, which is why it is not consulted here.
    const result = reconcileDeployedDefinition(matching());
    expect(result).toEqual({ reconciled: true, problems: [] });
  });

  it("passes when allowed values and entity types are ordered differently", () => {
    // Cardinality is SINGLE, so an allowed value is selected by token and never
    // by position. Failing on order would refuse a catalog that agrees.
    const reordered = matching();
    const result = reconcileDeployedDefinition({
      ...reordered,
      allowedValues: [...reordered.allowedValues].reverse(),
      entityTypeUrns: [...reordered.entityTypeUrns].reverse(),
    });
    expect(result.reconciled).toBe(true);
  });

  it("fails when an allowed value is missing, and names it", () => {
    const result = reconcileDeployedDefinition({
      ...matching(),
      allowedValues: matching().allowedValues.filter((v) => v.stringValue !== "OBSERVED"),
    });
    expect(result.reconciled).toBe(false);
    expect(result.problems).toContainEqual(expect.stringContaining('"OBSERVED" is not deployed'));
  });

  it("fails when an allowed value nobody derives is deployed", () => {
    // A catalog offering a fourth token invites a human to set it by hand, and
    // this tool would then read back a tier its own lattice cannot produce.
    const result = reconcileDeployedDefinition({
      ...matching(),
      allowedValues: [...matching().allowedValues, { stringValue: "TRUSTED", description: "ok" }],
    });
    expect(result.reconciled).toBe(false);
    expect(result.problems).toContainEqual(
      expect.stringContaining('"TRUSTED" is not part of the evidence lattice'),
    );
  });

  it("fails when a value's description states a different rule", () => {
    // The tokens still match, so every mechanical check on values passes. This
    // is the divergence that is invisible unless the prose itself is compared.
    const result = reconcileDeployedDefinition({
      ...matching(),
      allowedValues: matching().allowedValues.map((v) =>
        v.stringValue === "VERIFIED" ? { ...v, description: "at least one check was executed" } : v,
      ),
    });
    expect(result.reconciled).toBe(false);
    expect(result.problems).toContainEqual(expect.stringContaining("allowedValues[VERIFIED]"));
    expect(result.problems).toContainEqual(
      expect.stringContaining("at least one check was executed"),
    );
  });

  it("fails when the property description states a different rule", () => {
    const result = reconcileDeployedDefinition({
      ...matching(),
      description: "Evidence tier. VERIFIED: at least one record has a check.",
    });
    expect(result.reconciled).toBe(false);
    expect(result.problems).toContainEqual(expect.stringContaining("description: required"));
  });

  it("fails on a changed displayName, cardinality or value type", () => {
    for (const patch of [
      { displayName: "Evidence" },
      { cardinality: "MULTIPLE" },
      { valueTypeUrn: "urn:li:dataType:datahub.number" },
    ]) {
      expect(reconcileDeployedDefinition({ ...matching(), ...patch }).reconciled).toBe(false);
    }
  });

  it("fails on a differing entity type set", () => {
    const result = reconcileDeployedDefinition({
      ...matching(),
      entityTypeUrns: ["urn:li:entityType:datahub.dataJob"],
    });
    expect(result.reconciled).toBe(false);
    expect(result.problems).toContainEqual(expect.stringContaining("entityTypes: required"));
  });

  it("fails when the definition could not be read, rather than skipping the check", () => {
    // The tempting reading is that an unreadable definition is unknown and so
    // not yet a problem. It is the opposite: writing a tier value is least
    // defensible exactly when nothing is known about how it will be read.
    const result = reconcileDeployedDefinition(null);
    expect(result.reconciled).toBe(false);
    expect(result.problems).toContainEqual(expect.stringContaining("could not be read"));
  });

  it("reports every divergence at once, so one re-run shows the whole diff", () => {
    const result = reconcileDeployedDefinition({
      ...matching(),
      displayName: "Evidence",
      description: "something else",
      allowedValues: [{ stringValue: "TRUSTED", description: "ok" }],
    });
    expect(result.reconciled).toBe(false);
    // displayName, description, three missing tokens, one unexpected token.
    expect(result.problems.length).toBeGreaterThanOrEqual(6);
  });

  it("never repairs, migrates or returns a definition to write", () => {
    // Detection and reconciliation, not silent rewriting. The absence of any
    // repair affordance is the invariant; asserting the shape of the result
    // keeps a later "helpful" auto-fix from being added without a decision.
    const result = reconcileDeployedDefinition({ ...matching(), displayName: "Evidence" });
    expect(Object.keys(result).sort()).toEqual(["problems", "reconciled"]);
  });
});
