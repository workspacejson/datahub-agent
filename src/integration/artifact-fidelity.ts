/**
 * Whether a committed proof-corpus artifact is what the producer actually emits.
 *
 * The distinction this module exists for is the one HAC-227 was closed against
 * and should not have been: **validity is not fidelity.** The committed
 * jaffle_shop artifact passed `validate()` and `validateV4()` while carrying
 * five of the producer's eight `generated` sections, because `generated` is
 * `additionalProperties: true` and a permissive object accepts a subset. The
 * check passed; the claim it stood for was false.
 *
 * So the comparison here is over bytes and key sets, never over a validator.
 *
 * Two fields cannot be compared across runs and are normalised away. They are
 * enumerated rather than pattern-matched, because "anything that looks like a
 * timestamp" is how a real difference gets excused later:
 *
 *   - `generated.generatedAt`
 *   - `generated.hygiene.scannedAt`
 *
 * Everything else that differs is reported by path. A corpus may record an
 * expected difference — the transfermarkt artifact was produced by a newer
 * released CLI than this repository pins — but it records it as data the test
 * asserts against, not as a hole in the comparison.
 */

import { createHash } from "node:crypto";

/** Fields the producer stamps per run. Normalised away; nothing else is. */
export const RUN_STAMPED_FIELDS = [
  "generated.generatedAt",
  "generated.hygiene.scannedAt",
] as const;

/**
 * Render an artifact exactly as `scripts/build-corpus-fixture.mjs` writes it.
 *
 * Kept here rather than duplicated in a test, so a change to how fixtures are
 * written cannot leave the fidelity check comparing against a shape nothing
 * produces.
 */
export function renderArtifact(artifact: unknown): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export function digest(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function withoutRunStamps(artifact: unknown): unknown {
  const copy = structuredClone(artifact) as Record<string, Record<string, unknown>>;
  const generated = copy?.generated;
  if (generated && typeof generated === "object") {
    delete generated.generatedAt;
    const hygiene = generated.hygiene as Record<string, unknown> | undefined;
    if (hygiene && typeof hygiene === "object") delete hygiene.scannedAt;
  }
  return copy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every path at which two artifacts differ, named.
 *
 * Reporting paths rather than a boolean is the point: "the artifact does not
 * match" sends a reader to a 1,900-line diff, while "generated.conventions is
 * missing" names the defect. The N-1 case — a dropped `generated` section — is
 * the one a `validate()`-based check accepts, so it has to be the one this
 * names most clearly.
 */
export function differingPaths(committed: unknown, fresh: unknown, prefix = ""): string[] {
  const a = prefix === "" ? withoutRunStamps(committed) : committed;
  const b = prefix === "" ? withoutRunStamps(fresh) : fresh;

  if (isRecord(a) && isRecord(b)) {
    const paths: string[] = [];
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (!(key in a)) paths.push(`${path}: present in the producer run, absent from the committed artifact`);
      else if (!(key in b)) paths.push(`${path}: present in the committed artifact, absent from the producer run`);
      else paths.push(...differingPaths(a[key], b[key], path));
    }
    return paths.sort();
  }

  return JSON.stringify(a) === JSON.stringify(b)
    ? []
    : [`${prefix || "(root)"}: differs`];
}

export interface FidelityReport {
  /** Paths that differ, after the run-stamped fields are normalised away. */
  differences: string[];
  /** Whether the rendered bytes match once those fields are normalised. */
  bytesMatch: boolean;
}

export function compareArtifact(committed: unknown, fresh: unknown): FidelityReport {
  return {
    differences: differingPaths(committed, fresh),
    bytesMatch: renderArtifact(withoutRunStamps(committed)) === renderArtifact(withoutRunStamps(fresh)),
  };
}

/**
 * What a corpus's committed artifact is allowed to differ from a fresh run by,
 * and why. An empty list is the normal case; an entry is a recorded fact, not a
 * waiver, and the test asserts the difference is *exactly* this.
 */
export interface CorpusFidelityExpectation {
  /** Directory under `test/fixtures/`. */
  fixture: string;
  /** Repository the sidecar names. */
  repository: string;
  /** Commit the sidecar names. */
  commit: string;
  /** Producer version the sidecar names, which may not be the pinned one. */
  producer: string;
  /** Paths expected to differ from a run with this repository's pinned CLI. */
  expectedDifferences: string[];
  /** Why each expected difference exists. Empty when there are none. */
  reason: string | null;
}
