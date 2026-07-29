/**
 * Committed evidence must account for where it came from.
 *
 * This repository's thesis is that a claim needs observable evidence, and a
 * fixture is a claim: it asserts "this is what the system produced". A fixture
 * with no recorded derivation asserts that on the author's word, which is the
 * one form of evidence the project refuses everywhere else.
 *
 * Two properties, and they fail for different reasons on purpose:
 *
 *   1. A sidecar's recorded digest matches the artifact's bytes. This catches an
 *      artifact edited after its provenance was written — the case where the
 *      sidecar's account of how the file was made quietly becomes fiction.
 *
 *   2. Every fixture either has a sidecar or is named below with a reason. New
 *      un-provenanced evidence fails; the ones that predate this rule are
 *      visible rather than silent, which is the difference between a known gap
 *      and an unknown one.
 *
 * Both were watched failing before being committed. An invariant authored
 * against already-conforming code has never demonstrated that it catches
 * anything, and this file would otherwise be asserting its own correctness.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtures = join(root, "test/fixtures");

/**
 * Fixtures committed before this rule existed, each with the reason it carries
 * no derivation record. This list may shrink. An entry added to it needs the
 * same justification as any other stated absence — "we did not get to it" is a
 * reason, "it is fine" is not.
 */
const WITHOUT_PROVENANCE: Record<string, string> = {
  "golden/change-impact-event.root.json":
    "Emitted against the Jaffle corpus before the sidecar convention existed. Reproducible via scripts/emit-change-impact-event.mjs; the derivation is recorded in evaluation/proof-corpus.md rather than beside the artifact. HAC-145 rebinds it.",
  "golden/change-impact-event.nested.json":
    "As above, for the nested-path proof. Same emitter, same corpus pinning, same missing sidecar.",
  "readiness/game_events.upstream.json":
    "Captured by scripts/derive-readiness-manifest.mjs under HAC-231; the derivation and its command are recorded in evaluation/hac-231/readiness-manifest-derivation.md rather than in a sidecar.",
  "readiness/game_events.downstream.json":
    "As above, for the downstream direction. Same script, same pinned revision, same missing sidecar.",
  "proof-corpus/manifest.json":
    "The dbt manifest as produced by the pinned Jaffle corpus at 36bde6cb. It is an input to the fixtures rather than a fixture this repository derived, and its provenance is the corpus pin recorded in evaluation/proof-corpus.md.",
};

const isSidecar = (name: string) => name.endsWith("-provenance.json") || name.endsWith(".provenance.json");

/** Every JSON file under test/fixtures, as repo-relative paths. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return entry.endsWith(".json") ? [full] : [];
  });
}

/** The artifact a sidecar describes: `X-provenance.json` and `X.provenance.json` both describe `X.json`. */
function artifactFor(sidecar: string): string {
  return sidecar.replace(/[-.]provenance\.json$/, ".json");
}

const everyJson = walk(fixtures);
const sidecars = everyJson.filter((f) => isSidecar(f));
const artifacts = everyJson.filter((f) => !isSidecar(f));

describe("a sidecar's digest accounts for the artifact it describes", () => {
  it("finds sidecars to check, so a rename cannot empty this suite", () => {
    // Without this, moving the fixtures would turn every assertion below into a
    // vacuous pass over an empty list — a green suite proving nothing.
    expect(sidecars.length).toBeGreaterThan(0);
  });

  it.each(sidecars.map((s) => [relative(fixtures, s), s] as const))("%s", (_label, sidecarPath) => {
    const artifactPath = artifactFor(sidecarPath);
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as Record<string, unknown>;

    // Every digest the sidecar records, whatever the key is called. A sidecar
    // may legitimately record several — the artifact's own and the base it was
    // derived from — and only one of them needs to be the artifact's.
    const recorded = Object.values(sidecar)
      .filter((v): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v));

    expect(recorded.length, `${relative(root, sidecarPath)} records no sha256 digest`).toBeGreaterThan(0);

    const actual = createHash("sha256").update(readFileSync(artifactPath)).digest("hex");
    expect(
      recorded,
      `${relative(root, artifactPath)} hashes to ${actual}, which its sidecar does not record. ` +
      `Either the artifact was edited after its provenance was written, or the sidecar describes a different file.`,
    ).toContain(actual);
  });
});

describe("every committed fixture accounts for where it came from", () => {
  it.each(artifacts.map((a) => [relative(fixtures, a), a] as const))("%s", (label, artifactPath) => {
    const hasSidecar = sidecars.some((s) => artifactFor(s) === artifactPath);
    if (hasSidecar) return;

    expect(
      WITHOUT_PROVENANCE,
      `${label} is committed evidence with no derivation record and no entry explaining why. ` +
      `Add a sidecar recording how it was produced, or name it in WITHOUT_PROVENANCE with the reason.`,
    ).toHaveProperty(label);
  });

  it("keeps the exemption list honest — no entry for a fixture that no longer exists", () => {
    // An exemption outliving its fixture is a reason nobody can check, and it
    // silently widens the rule for whatever is added at that path next.
    const present = new Set(artifacts.map((a) => relative(fixtures, a)));
    for (const exempt of Object.keys(WITHOUT_PROVENANCE)) {
      expect(present, `WITHOUT_PROVENANCE names ${exempt}, which is not committed`).toContain(exempt);
    }
  });

  it("requires every exemption to state a reason, not merely to exist", () => {
    for (const [file, reason] of Object.entries(WITHOUT_PROVENANCE)) {
      expect(reason.length, `${file} is exempted with no reason`).toBeGreaterThan(40);
    }
  });
});
