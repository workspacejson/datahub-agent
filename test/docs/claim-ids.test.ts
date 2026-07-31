/**
 * `docs/claim-ids.json` is the machine-readable index that drives the story
 * page's proof ledger. `docs/claims.md` is the human-readable source of truth.
 *
 * The two drifted once: `claims.md` moved the node-accounting figure out of
 * "Silent failure" into "Node accounting" (commit 6ea9f56), but `claim-ids.json`
 * was not updated, so the story page showed "23 of 28" under "The silent zero
 * failure" — the exact conflation the move existed to prevent.
 *
 * This test pins every entry in the JSON to the section and claim text in the
 * markdown, so the next drift fails CI rather than a judge.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const claimsMd = readFileSync(join(repoRoot, "docs/claims.md"), "utf8");
const claimIds = JSON.parse(readFileSync(join(repoRoot, "docs/claim-ids.json"), "utf8")) as {
  version: number;
  source: string;
  claims: { id: string; claim: string; section: string }[];
};

function sectionsInClaimsMd(): Map<string, string> {
  const map = new Map<string, string>();
  let currentHeading: string | null = null;
  const lines = claimsMd.split("\n");
  const body: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentHeading !== null) {
        map.set(currentHeading, body.join("\n"));
        body.length = 0;
      }
      currentHeading = line.slice(3).trim();
    } else if (currentHeading !== null) {
      body.push(line);
    }
  }
  if (currentHeading !== null) {
    map.set(currentHeading, body.join("\n"));
  }
  return map;
}

describe("docs/claim-ids.json stays aligned with docs/claims.md", () => {
  const sections = sectionsInClaimsMd();

  it("references a source file that exists", () => {
    expect(claimIds.source).toBe("docs/claims.md");
  });

  it("has a stable version", () => {
    expect(typeof claimIds.version).toBe("number");
  });

  it("every entry's section exists as a heading in claims.md", () => {
    for (const entry of claimIds.claims) {
      expect(sections.has(entry.section), `section "${entry.section}" for ${entry.id} not found in claims.md`).toBe(true);
    }
  });

  it("every entry's claim text appears in its section's table", () => {
    for (const entry of claimIds.claims) {
      const sectionBody = sections.get(entry.section);
      expect(sectionBody, `section "${entry.section}" not found`).toBeDefined();
      if (!sectionBody) continue;
      expect(
        sectionBody.includes(entry.claim),
        `${entry.id}: claim text "${entry.claim}" not found in section "${entry.section}" of claims.md`,
      ).toBe(true);
    }
  });

  it("does not place a node-accounting claim in the silent-failure section", () => {
    const silentFailureEntries = claimIds.claims.filter((c) => c.section === "Silent failure");
    for (const entry of silentFailureEntries) {
      expect(
        entry.claim.toLowerCase(),
        `${entry.id} is in "Silent failure" but references node accounting`,
      ).not.toContain("extractmodels");
    }
  });
});
