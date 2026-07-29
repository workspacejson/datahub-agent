/**
 * Legacy-seam guard (HAC-273).
 *
 * Prevents reintroduction of the deleted URN reconstruction seam
 * (`src/adapters/workspacejson/urn.ts`) and its isolated test
 * (`urn-join.integration.test.ts`). The guard scans `src/**` for the
 * deleted symbols and known reconstruction expressions. It does not
 * scan `test/**` — this file itself contains the forbidden strings as
 * detector inputs.
 *
 * This is a legacy-seam guard, not a guarantee against all possible
 * future reconstruction mechanisms.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const DELETED_SYMBOLS = [
  "parseDatasetUrn",
  "resolveUrn",
  "indexNodesByDatasetName",
  "datasetNameForNode",
] as const;

const DELETED_MODULE_PATH = "src/adapters/workspacejson/urn.ts";
const DELETED_TEST_PATH = "test/adapters/workspacejson/urn-join.integration.test.ts";

/**
 * Detect whether a source string contains any of the deleted seam symbols
 * or known reconstruction expressions. Used both for the production scan
 * and the positive control.
 */
function detectSeamSymbols(source: string): string[] {
  const hits: string[] = [];
  for (const sym of DELETED_SYMBOLS) {
    if (source.includes(sym)) hits.push(sym);
  }
  return hits;
}

describe("legacy-seam guard (HAC-273)", () => {
  it("the deleted module path does not exist", () => {
    expect(existsSync(join(repoRoot, DELETED_MODULE_PATH))).toBe(false);
  });

  it("the deleted test path does not exist", () => {
    expect(existsSync(join(repoRoot, DELETED_TEST_PATH))).toBe(false);
  });

  it("no source file under src/ contains deleted seam symbols", () => {
    const srcDir = join(repoRoot, "src");

    function walk(dir: string): string[] {
      const files: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          files.push(...walk(full));
        } else if (full.endsWith(".ts") || full.endsWith(".mjs")) {
          files.push(full);
        }
      }
      return files;
    }

    const violations: string[] = [];
    for (const file of walk(srcDir)) {
      const content = readFileSync(file, "utf8");
      const hits = detectSeamSymbols(content);
      if (hits.length > 0) {
        violations.push(`${file}: ${hits.join(", ")}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("positive control: the detector fires on a synthetic string containing seam symbols", () => {
    const synthetic = `
      import { parseDatasetUrn, resolveUrn } from "./urn.js";
      const index = indexNodesByDatasetName(nodes);
      const name = datasetNameForNode(node);
    `;
    const hits = detectSeamSymbols(synthetic);
    expect(hits).toContain("parseDatasetUrn");
    expect(hits).toContain("resolveUrn");
    expect(hits).toContain("indexNodesByDatasetName");
    expect(hits).toContain("datasetNameForNode");
    expect(hits.length).toBe(4);
  });
});
