/**
 * Fidelity, not validity.
 *
 * The previous acceptance for these fixtures was that `validate()` and
 * `validateV4()` return true, and a test asserted it. Both were satisfied by an
 * artifact carrying five of the producer's eight `generated` sections, because
 * `generated` is `additionalProperties: true` and a permissive object accepts a
 * subset. The check passed while the claim it stood for — *this is what the
 * producer emits* — was false.
 *
 * A criterion that cannot fail is not a criterion, so every check here is
 * written against a deliberately broken input first. N-1 is the case the old
 * acceptance let through, and it is the one this file exists for.
 *
 * The regeneration itself is measured, not asserted from inspection: on
 * 2026-07-28 `@workspacejson/cli@0.5.0` was run against `jaffle_shop_duckdb` at
 * `36bde6cb` and `transfermarkt-datasets` at `59fa295c`, and the committed
 * artifacts were replaced with / checked against those runs. The last block below
 * re-runs it against a local checkout, gated on a WORKSPACEJSON_CORPUS_* variable.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  compareArtifact,
  differingPaths,
  digest,
  renderArtifact,
  RUN_STAMPED_FIELDS,
  type CorpusFidelityExpectation,
} from "../../src/integration/artifact-fidelity.js";
import { readArtifactIdentity } from "../../src/integration/workspace-evidence.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");

/**
 * What each corpus is allowed to differ from a fresh run by, and why.
 *
 * An entry is a recorded measurement, not a waiver: the test asserts the
 * difference is *exactly* this list, so an unexpected drift fails and a
 * disappearing expected one fails too.
 */
const CORPORA: CorpusFidelityExpectation[] = [
  {
    fixture: "proof-corpus",
    repository: "https://github.com/dbt-labs/jaffle_shop_duckdb",
    commit: "36bde6cba69d962b83be1d52fc65a0dce1cb4ebb",
    producer: "@workspacejson/cli@0.5.0",
    expectedDifferences: [],
    reason: null,
  },
  {
    fixture: "proof-corpus-transfermarkt",
    repository: "https://github.com/dcaribou/transfermarkt-datasets",
    commit: "59fa295c51fc23466f3a71542f8bf3d1335daa83",
    producer: "@workspacejson/cli@0.5.1",
    expectedDifferences: ["generated.by.version: differs"],
    reason:
      "Produced by 0.5.1, a released version this repository does not pin. Every other section reproduces byte-for-byte under the pinned 0.5.0.",
  },
];

function artifactPath(fixture: string) {
  return join(fixtures, fixture, "workspace.json");
}
function read(fixture: string) {
  const bytes = readFileSync(artifactPath(fixture), "utf8");
  return { bytes, artifact: JSON.parse(bytes) as Record<string, unknown> };
}
function sidecar(fixture: string) {
  return JSON.parse(readFileSync(join(fixtures, fixture, "workspace-provenance.json"), "utf8")) as
    Record<string, unknown>;
}

describe.each(CORPORA)("$fixture is what the producer emits", (corpus) => {
  it("carries every generated section the producer writes", () => {
    // The jaffle_shop artifact carried five of eight. Measured against a fresh
    // 0.5.0 run at the pinned commit, not inferred from the other corpus.
    expect(Object.keys(read(corpus.fixture).artifact.generated as object).sort()).toEqual([
      "by", "conventions", "fileIndex", "frameworkManifest",
      "generatedAt", "hygiene", "specVersion", "topology",
    ]);
  });

  it("has a sidecar bound to exactly these bytes", () => {
    const { bytes } = read(corpus.fixture);
    expect(sidecar(corpus.fixture).workspace_sha256).toBe(digest(bytes));
  });

  it("records the corpus identity and the producer that established it", () => {
    const side = sidecar(corpus.fixture);
    expect(side.corpus).toBe(corpus.repository);
    expect(side.commit).toBe(corpus.commit);
    expect(side.producer).toBe(corpus.producer);
  });

  it("records a derivation command a reader can actually run", () => {
    // It was previously an absolute path to a resolved CLI entry on one
    // machine — provenance that looks preserved and cannot be repeated.
    const command = String(sidecar(corpus.fixture).command);
    expect(command).toContain("scripts/build-corpus-fixture.mjs");
    expect(command).not.toMatch(/\/(Users|home)\//);
  });

  it("is written exactly as the builder writes it", () => {
    const { bytes, artifact } = read(corpus.fixture);
    expect(bytes).toBe(renderArtifact(artifact));
  });
});

describe("the fidelity comparison fails on the cases it exists for", () => {
  const { artifact } = read("proof-corpus");

  it("N-1 — names a dropped generated section, which validate() accepts", () => {
    // This is the exact defect the previous acceptance was closed against: a
    // subset artifact validates, because `generated` is additionalProperties.
    const broken = structuredClone(artifact) as { generated: Record<string, unknown> };
    delete broken.generated.conventions;
    const report = compareArtifact(broken, artifact);
    expect(report.bytesMatch).toBe(false);
    expect(report.differences).toContain(
      "generated.conventions: present in the producer run, absent from the committed artifact",
    );
  });

  it("N-2 — names a mutated fileIndex key and breaks the digest independently", () => {
    const broken = structuredClone(artifact) as { generated: { fileIndex: Record<string, unknown> } };
    delete broken.generated.fileIndex["models/customers.sql"];
    broken.generated.fileIndex["models/customers_renamed.sql"] = {};
    const report = compareArtifact(broken, artifact);
    expect(report.differences.some((d: string) => d.includes("models/customers.sql"))).toBe(true);
    // Two independent failures, deliberately: the comparison and the digest do
    // not depend on each other, so neither can quietly cover for the other.
    expect(digest(renderArtifact(broken))).not.toBe(sidecar("proof-corpus").workspace_sha256);
  });

  it("N-3 — a sidecar digest changed on its own fails the real binding check", () => {
    // Driven through `readArtifactIdentity`, the function consumers actually
    // call, rather than through a restatement of its arithmetic here. A test
    // that recomputes the digest itself asserts that SHA-256 works.
    const scratch = mkdtempSync(join(tmpdir(), "fidelity-n3-"));
    writeFileSync(join(scratch, "workspace.json"), read("proof-corpus").bytes);
    writeFileSync(join(scratch, "workspace-provenance.json"), JSON.stringify({
      ...sidecar("proof-corpus"),
      workspace_sha256: createHash("sha256").update("some other artifact").digest("hex"),
    }, null, 2));

    const identity = readArtifactIdentity(join(scratch, "workspace.json"));
    expect(identity.status).toBe("digest-mismatch");
    expect(identity.repository).toBeNull();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("N-4 — an artifact regenerated at a different commit fails on identity, not only digest", () => {
    // The stale-artifact case, and the reason it needs its own check: the
    // digest is recomputed as part of regenerating, so a fixture rebuilt at the
    // wrong commit with a correctly-updated sidecar passes every byte check it
    // is subjected to. Only the recorded corpus identity catches it.
    const scratch = mkdtempSync(join(tmpdir(), "fidelity-n4-"));
    const elsewhere = structuredClone(read("proof-corpus").artifact) as { generated: Record<string, unknown> };
    elsewhere.generated.generatedAt = "2030-01-01T00:00:00.000Z";
    const bytes = renderArtifact(elsewhere);
    writeFileSync(join(scratch, "workspace.json"), bytes);
    writeFileSync(join(scratch, "workspace-provenance.json"), JSON.stringify({
      ...sidecar("proof-corpus"),
      commit: "0000000000000000000000000000000000000000",
      workspace_sha256: digest(bytes),   // dutifully updated, as a rebuild would
    }, null, 2));

    const identity = readArtifactIdentity(join(scratch, "workspace.json"));
    expect(identity.status).toBe("found");            // the digest check is satisfied
    expect(identity.revision).not.toBe(CORPORA[0]!.commit);  // and the identity is still wrong
    rmSync(scratch, { recursive: true, force: true });
  });

  it("normalises the run-stamped fields, and nothing else", () => {
    const stamped = structuredClone(artifact) as { generated: Record<string, unknown> };
    stamped.generated.generatedAt = "1999-01-01T00:00:00.000Z";
    (stamped.generated.hygiene as Record<string, unknown>).scannedAt = "1999-01-01T00:00:00.000Z";
    expect(compareArtifact(stamped, artifact).differences).toEqual([]);

    // A field that is not on the list is a real difference, whatever it looks
    // like — including something timestamp-shaped.
    (stamped.generated.hygiene as Record<string, unknown>).score = 1;
    expect(compareArtifact(stamped, artifact).differences).toContain("generated.hygiene.score: differs");
    expect(RUN_STAMPED_FIELDS).toEqual(["generated.generatedAt", "generated.hygiene.scannedAt"]);
  });

  it("reports an identical pair as identical, so the check can pass honestly", () => {
    expect(compareArtifact(artifact, structuredClone(artifact))).toEqual({ differences: [], bytesMatch: true });
  });
});

/**
 * The regeneration itself.
 *
 * Skipped without a checkout, and the skip is loud: a silently-skipped fidelity
 * test reads as a passing one. Set `WORKSPACEJSON_CORPUS_<NAME>` to a checkout
 * at the pinned commit to run it.
 *
 *   WORKSPACEJSON_CORPUS_PROOF_CORPUS=/path/to/jaffle_shop_duckdb npx vitest run
 */
// Resolved by path rather than `import.meta.resolve`, which vitest's SSR
// transform does not provide, and rather than `createRequire().resolve`, which
// throws ERR_PACKAGE_PATH_NOT_EXPORTED against this package's ESM-only exports
// map — the same constraint `build-corpus-fixture.mjs` documents.
const cliEntry = resolve(fixtures, "../../node_modules/@workspacejson/cli/dist/cli.js");

describe.each(CORPORA)("$fixture against a fresh producer run", (corpus) => {
  const envVar = `WORKSPACEJSON_CORPUS_${corpus.fixture.toUpperCase().replace(/-/g, "_")}`;
  const checkout = process.env[envVar];

  it.skipIf(!checkout || !existsSync(String(checkout)))(
    `regenerates and differs by exactly the recorded list (set ${envVar} to run)`,
    () => {
      const at = resolve(String(checkout));
      expect(execFileSync("git", ["-C", at, "rev-parse", "HEAD"], { encoding: "utf8" }).trim())
        .toBe(corpus.commit);

      execFileSync(process.execPath, [cliEntry, "generate", at], { cwd: at, encoding: "utf8" });
      const fresh = JSON.parse(readFileSync(join(at, ".agents", "workspace.json"), "utf8"));

      expect(differingPaths(read(corpus.fixture).artifact, fresh)).toEqual(corpus.expectedDifferences);
      if (corpus.expectedDifferences.length > 0) expect(corpus.reason).toBeTruthy();
    },
  );
});
