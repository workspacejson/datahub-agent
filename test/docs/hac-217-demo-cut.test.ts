import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ledgerPath = fileURLToPath(
  new URL("../../docs/hac-217-demo-cut.md", import.meta.url),
);

describe("HAC-217 ratification ledger", () => {
  it("keeps every canonical frame and degraded state explicitly dispositioned", async () => {
    const ledger = await readFile(ledgerPath, "utf8");

    for (const requiredState of [
      "Reading rules / source and status vocabulary",
      "Impact / five-second frame",
      "Change plan / DataHub-only versus Joined delta",
      "Receipts / accounting, provenance, writeback, limitations",
      "No declared lineage returned",
      "Not queried / unavailable",
      "Source or revision cannot be safely anchored / repository revision mismatch",
      "Partial resolution with every unresolved item named",
      "Mutation accepted; intended state not observed",
      "Failed / blocking evidence state",
      "Source found without workspace.json",
      "Lineage found without an actionable repository source",
    ]) {
      expect(ledger).toContain(`| ${requiredState} |`);
    }

    expect(ledger).toContain(
      "| Source or revision cannot be safely anchored / repository revision mismatch | No | Yes | **Explicit defer decision:**",
    );
  });

  it("retains the mandatory demo cut without promoting provisional hero evidence", async () => {
    const ledger = await readFile(ledgerPath, "utf8");

    for (const mandatoryState of [
      "Impact / five-second frame",
      "Change plan / DataHub-only versus Joined delta",
      "Receipts / accounting, provenance, writeback, limitations",
      "Partial resolution with every unresolved item named",
      "Mutation accepted; intended state not observed",
    ]) {
      expect(ledger).toContain(`| ${mandatoryState} | Yes | No |`);
    }

    expect(ledger).toContain("DESIGN\nPLACEHOLDER · NOT OBSERVED DATA");
    expect(ledger).toContain("is not approved\nfor a judge-facing hero unless HAC-225 proves");
  });
});
