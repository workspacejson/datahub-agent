import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  PROVENANCE_SIDECAR,
  assessWorkspaceEvidence,
  readArtifactIdentity,
} from "../../src/integration/workspace-evidence.js";

const subject = { repository: "https://github.com/dcaribou/transfermarkt-datasets", revision: "59fa295c" };
const index = { "dbt/models/curated/game_events.sql": {} };

describe("workspace evidence integrity", () => {
  it("allows the one exact corpus-matched repository path", () => {
    const result = assessWorkspaceEvidence(subject, subject, index, "models/curated/game_events.sql");
    expect(result.integrity).toBe("exact-match");
    expect(result.repositoryRelativePath).toBe("dbt/models/curated/game_events.sql");
    expect(result.fileIndexKeys).toBe(1);
    expect(result.candidates).toEqual(["dbt/models/curated/game_events.sql"]);
  });
  it("refuses a repository mismatch", () => {
    const result = assessWorkspaceEvidence(subject, { ...subject, repository: "https://github.com/dbt-labs/jaffle_shop_duckdb" }, index, "models/curated/game_events.sql");
    expect(result.integrity).toBe("repository-mismatch");
    expect(result.fileIndexKeys).toBe(1);
    expect(result.repositoryRelativePath).toBeNull();
  });
  it("refuses a revision mismatch", () => {
    const result = assessWorkspaceEvidence(subject, { ...subject, revision: "other" }, index, "models/curated/game_events.sql");
    expect(result.integrity).toBe("revision-mismatch");
    expect(result.fileIndexKeys).toBe(1);
    expect(result.repositoryRelativePath).toBeNull();
  });
  it("states unavailable artifacts", () => {
    const result = assessWorkspaceEvidence(subject, null, null, "models/curated/game_events.sql");
    expect(result.integrity).toBe("artifact-unavailable");
    expect(result.fileIndexKeys).toBeNull();
    expect(result.repositoryRelativePath).toBeNull();
    expect(result.candidates).toEqual([]);
  });
  it("refuses zero path candidates", () => {
    const result = assessWorkspaceEvidence(subject, subject, index, "models/missing.sql");
    expect(result.integrity).toBe("path-unresolved");
    expect(result.candidates).toEqual([]);
  });
  it("refuses ambiguous path candidates", () => {
    const result = assessWorkspaceEvidence(subject, subject, { ...index, "other/models/curated/game_events.sql": {} }, "models/curated/game_events.sql");
    expect(result.integrity).toBe("path-ambiguous");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates).toContain("dbt/models/curated/game_events.sql");
    expect(result.candidates).toContain("other/models/curated/game_events.sql");
  });
  it("normalises a .git suffix on the repository URL before comparing", () => {
    const artifactWithGit = { ...subject, repository: "https://github.com/dcaribou/transfermarkt-datasets.git" };
    const result = assessWorkspaceEvidence(subject, artifactWithGit, index, "models/curated/game_events.sql");
    expect(result.integrity).toBe("exact-match");
  });
  it("normalises a trailing slash on the repository URL before comparing", () => {
    const artifactWithSlash = { ...subject, repository: "https://github.com/dcaribou/transfermarkt-datasets/" };
    const result = assessWorkspaceEvidence(subject, artifactWithSlash, index, "models/curated/game_events.sql");
    expect(result.integrity).toBe("exact-match");
  });
  it("refuses a null dbtFilePath even when repository and revision match", () => {
    const result = assessWorkspaceEvidence(subject, subject, index, null);
    expect(result.integrity).toBe("path-unresolved");
    expect(result.repositoryRelativePath).toBeNull();
  });
  it("strips a leading ./ from the dbtFilePath before matching", () => {
    const result = assessWorkspaceEvidence(subject, subject, index, "./models/curated/game_events.sql");
    expect(result.integrity).toBe("exact-match");
    expect(result.repositoryRelativePath).toBe("dbt/models/curated/game_events.sql");
  });
});

describe("resolving artifact identity from its provenance sidecar", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const committedArtifact = join(here, "../fixtures/proof-corpus/workspace.json");

  it("finds the sidecar beside the committed proof-corpus artifact", () => {
    // Asserts the sidecar was FOUND, not merely that the resolver ran. An
    // earlier draft of this guard derived the filename as
    // `workspace.provenance.json` while the committed file is
    // `workspace-provenance.json`; it located nothing, reported identity
    // unknown, and every test it had written still passed. A guard that cannot
    // find its input and reports "unknown" is a silent bypass wearing the
    // costume of caution — so the found-ness is the assertion.
    const identity = readArtifactIdentity(committedArtifact);
    expect(identity.status).toBe("found");
    expect(identity.repository).toBe("https://github.com/dbt-labs/jaffle_shop_duckdb");
    expect(identity.revision).toBe("36bde6cba69d962b83be1d52fc65a0dce1cb4ebb");
  });

  it("names the sidecar in one place, so a rename cannot silently unhook it", () => {
    expect(PROVENANCE_SIDECAR).toBe("workspace-provenance.json");
  });

  /** Writes an artifact plus a sidecar whose digest can be made to disagree. */
  function fixture(bind: "correct" | "stale"): string {
    const dir = mkdtempSync(join(tmpdir(), "ws-sidecar-"));
    const artifact = join(dir, "workspace.json");
    const body = readFileSync(committedArtifact);
    writeFileSync(artifact, body);
    const digest = createHash("sha256").update(body).digest("hex");
    writeFileSync(join(dir, PROVENANCE_SIDECAR), JSON.stringify({
      corpus: "https://github.com/example/repo",
      commit: "c".repeat(40),
      workspace_sha256: bind === "correct" ? digest : "0".repeat(64),
    }));
    return artifact;
  }

  it("accepts a sidecar bound to the artifact bytes", () => {
    expect(readArtifactIdentity(fixture("correct"))).toMatchObject({
      status: "found",
      repository: "https://github.com/example/repo",
    });
  });

  it("refuses a sidecar that has drifted from the artifact it describes", () => {
    // The failure the single-file shape did not have: provenance says commit X
    // while the artifact was regenerated at commit Y, and nothing notices. The
    // digest is what makes the pair correspond rather than merely coexist.
    const identity = readArtifactIdentity(fixture("stale"));
    expect(identity.status).toBe("digest-mismatch");
    expect(identity.repository).toBeNull();
    expect(identity.detail).toMatch(/drifted/);
  });

  it("refuses when no sidecar is present rather than assuming identity", () => {
    const dir = mkdtempSync(join(tmpdir(), "ws-nosidecar-"));
    const artifact = join(dir, "workspace.json");
    writeFileSync(artifact, "{}");
    expect(readArtifactIdentity(artifact).status).toBe("missing");
  });

  it("refuses an unparseable sidecar as unparseable, not missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ws-badsidecar-"));
    const artifact = join(dir, "workspace.json");
    writeFileSync(artifact, '{"generated":{}}');
    writeFileSync(join(dir, PROVENANCE_SIDECAR), "{not valid json}");
    const identity = readArtifactIdentity(artifact);
    expect(identity.status).toBe("unparseable");
    expect(identity.repository).toBeNull();
    expect(identity.detail).toMatch(/could not be read/);
  });

  it("refuses an unparseable artifact as unparseable, not artifact-missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ws-badartifact-"));
    const artifact = join(dir, "workspace.json");
    writeFileSync(artifact, "{not valid json}");
    writeFileSync(join(dir, PROVENANCE_SIDECAR), JSON.stringify({
      corpus: "https://github.com/example/repo",
      commit: "e".repeat(40),
      workspace_sha256: "0".repeat(64),
    }));
    const identity = readArtifactIdentity(artifact);
    expect(identity.status).toBe("unparseable");
    expect(identity.detail).toMatch(/could not be read/);
  });

  it("distinguishes a missing artifact from an unparseable one", () => {
    // Nothing failed to parse — the thing the sidecar claims to describe is not
    // there. Reporting that as "unparseable" would send a reader looking for
    // malformed JSON in a file that does not exist.
    const dir = mkdtempSync(join(tmpdir(), "ws-noartifact-"));
    writeFileSync(join(dir, PROVENANCE_SIDECAR), JSON.stringify({ corpus: "r", commit: "c", workspace_sha256: "x" }));
    const identity = readArtifactIdentity(join(dir, "workspace.json"));
    expect(identity.status).toBe("artifact-missing");
    expect(identity.detail).toMatch(/not present/);
  });

  it("hashes the bytes it was handed, not whatever is on disk afterwards", () => {
    // The caller parses the artifact and then asks for its identity. If the
    // digest were recomputed from a fresh read, the two could describe different
    // bytes — a race the binding exists to rule out.
    const dir = mkdtempSync(join(tmpdir(), "ws-bytes-"));
    const artifact = join(dir, "workspace.json");
    const original = Buffer.from('{"generated":{}}');
    writeFileSync(artifact, original);
    writeFileSync(join(dir, PROVENANCE_SIDECAR), JSON.stringify({
      corpus: "https://github.com/example/repo",
      commit: "d".repeat(40),
      workspace_sha256: createHash("sha256").update(original).digest("hex"),
    }));
    // Disk now disagrees with what the caller read.
    writeFileSync(artifact, Buffer.from('{"generated":{"changed":true}}'));
    expect(readArtifactIdentity(artifact, original).status).toBe("found");
    expect(readArtifactIdentity(artifact).status).toBe("digest-mismatch");
  });
});
