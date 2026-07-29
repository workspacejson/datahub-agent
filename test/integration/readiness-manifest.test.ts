/**
 * The committed readiness manifests are pinned expectations, not fixtures of
 * convenience. These tests hold them to that.
 *
 * The deliberate-mismatch block is the load-bearing half. A gate that only ever
 * sees the correct manifest cannot demonstrate it would reject a wrong one, and
 * a criterion that cannot fail is not a criterion — so every mutation below is
 * checked to actually break the match, in all three shapes the acceptance names:
 * one URN swapped, one added, one removed.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { observeReadiness } from "../../src/integration/readiness.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/readiness");

interface PinnedManifest {
  expectedUrns: string[];
  queryParameters: Record<string, string | number>;
  _provenance: Record<string, unknown> & { expectedSetDigest: string; manifestDigest: string };
}

const read = (name: string): PinnedManifest =>
  JSON.parse(readFileSync(join(fixtures, name), "utf8"));

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");

const MANIFESTS = [
  { file: "game_events.upstream.json", direction: "UPSTREAM", size: 8 },
  { file: "game_events.downstream.json", direction: "DOWNSTREAM", size: 1 },
] as const;

/** A reader that always returns exactly what the manifest expects. */
const perfectReader = (m: PinnedManifest) => async () => [...m.expectedUrns];

describe.each(MANIFESTS)("pinned readiness manifest: $file", ({ file, direction, size }) => {
  const manifest = read(file);

  it("declares its direction explicitly, one direction per manifest", () => {
    expect(manifest.queryParameters.direction).toBe(direction);
  });

  it("carries a non-empty expectation, so it cannot launder index lag into a claim", () => {
    expect(manifest.expectedUrns.length).toBe(size);
    expect(new Set(manifest.expectedUrns).size).toBe(size);
  });

  it("records digests that match the set it actually carries", () => {
    const sorted = [...new Set(manifest.expectedUrns)].sort();
    expect(manifest._provenance.expectedSetDigest).toBe(digest(sorted));
    expect(manifest._provenance.manifestDigest).toBe(
      digest({ expectedUrns: sorted, queryParameters: manifest.queryParameters }),
    );
  });

  it("names the pinned corpus and states the derivation is not from an observed response", () => {
    expect(manifest._provenance.commit).toBe("59fa295c51fc23466f3a71542f8bf3d1335daa83");
    expect(String(manifest._provenance.derivedFrom)).toMatch(/never from an observed DataHub response/);
  });

  it("carries the untested-branch caveat rather than implying full coverage", () => {
    expect(String(manifest._provenance.caveat)).toMatch(/UNTESTED, not proven/);
  });

  it("settles as ready against a catalog that matches it exactly", async () => {
    const result = await observeReadiness(manifest, 200, perfectReader(manifest));
    expect(result.disposition).toBe("ready");
    expect(result.expectedSetDigest).toBe(result.observedSetDigest);
    // The digest the observer computes must be the one the manifest recorded,
    // or the receipt would attest to a different set than the committed one.
    expect(result.manifestDigest).toBe(manifest._provenance.manifestDigest);
  });
});

describe("deliberate mismatch — each mutation must fail", () => {
  const manifest = read("game_events.upstream.json");
  const expected = manifest.expectedUrns;

  const swapped = [...expected.slice(1), "urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.dev.NOT_A_REAL_TABLE,PROD)"];
  const added = [...expected, "urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.dev.extra_table,PROD)"];
  const removed = expected.slice(0, -1);

  it.each([
    ["one URN swapped", swapped],
    ["one URN added", added],
    ["one URN removed", removed],
  ])("refuses to settle when the catalog has %s", async (_label, observed) => {
    const result = await observeReadiness(manifest, 60, async () => [...observed]);
    expect(result.disposition).not.toBe("ready");
    expect(result.expectedSetDigest).not.toBe(result.observedSetDigest);
  });

  it("is not satisfied by a matching count — eight edges can be the wrong eight", async () => {
    const wrongEight = expected.map((_, i) =>
      `urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.dev.decoy_${i},PROD)`);
    expect(wrongEight.length).toBe(expected.length);

    const result = await observeReadiness(manifest, 60, async () => wrongEight);
    expect(result.disposition).toBe("not-ready");
  });

  it("refuses an empty expectation outright rather than matching an empty catalog", async () => {
    const empty = { expectedUrns: [], queryParameters: manifest.queryParameters };
    const result = await observeReadiness(empty, 60, async () => []);
    expect(result.disposition).toBe("no-expectation");
    expect(result.observedSetDigest).toBeNull();
  });

  it("does not settle when the index is still converging and returns nothing", async () => {
    const result = await observeReadiness(manifest, 60, async () => []);
    expect(result.disposition).toBe("not-ready");
  });
});
