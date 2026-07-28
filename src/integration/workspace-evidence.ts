/**
 * Corpus-safe workspace.json selection for the judge event.  This is kept out
 * of the CLI script so the refusal behaviour is executable and testable.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { WorkspaceIntegrity } from "./change-impact-event.js";

export type { WorkspaceIntegrity };

/**
 * The sidecar filename, as one exported constant rather than a literal spelled
 * at each call site.
 *
 * A guard that cannot find its input degrades to "identity unknown", which reads
 * as caution and behaves as a silent bypass — absence read as safety, inside the
 * fix for absence read as safety. A single spelling that tests can assert
 * against is what keeps a rename from producing that failure quietly.
 */
export const PROVENANCE_SIDECAR = "workspace-provenance.json";

export type SidecarStatus =
  | "found"
  /** No sidecar beside the artifact. */
  | "missing"
  /** The artifact itself is not there to be described. */
  | "artifact-missing"
  /** One of the pair exists but could not be read as JSON. */
  | "unparseable"
  /** Both exist; the sidecar does not describe these bytes. */
  | "digest-mismatch";

export interface ArtifactIdentity {
  status: SidecarStatus;
  repository: string | null;
  revision: string | null;
  detail: string;
}

/**
 * Resolve which corpus an artifact describes, from its provenance sidecar.
 *
 * Provenance lives beside the artifact rather than inside it because the
 * published schema forbids unknown root keys — `additionalProperties: false`
 * (HAC-227). That separation creates a new failure the single-file shape did not
 * have: the sidecar can drift from the artifact it describes. So the sidecar
 * carries a SHA-256 of the artifact bytes, and a digest that does not match is a
 * refusal rather than a warning. Two things that must correspond, with something
 * enforcing correspondence — the same discipline the corpus match itself applies.
 */
export function readArtifactIdentity(
  artifactPath: string,
  /**
   * The artifact bytes, when the caller has already read them. Passing them
   * avoids a second read purely to hash, and — more importantly — guarantees the
   * digest is computed over the same bytes the caller parsed, rather than over
   * whatever is on disk a moment later.
   */
  artifactBytes?: Buffer,
): ArtifactIdentity {
  const sidecarPath = join(dirname(artifactPath), PROVENANCE_SIDECAR);
  const refused = (status: SidecarStatus, detail: string): ArtifactIdentity => ({
    status, repository: null, revision: null, detail,
  });

  if (!existsSync(sidecarPath)) {
    return refused("missing", `No provenance sidecar at ${sidecarPath}; artifact identity cannot be established.`);
  }
  if (!artifactBytes && !existsSync(artifactPath)) {
    // Distinct from `unparseable`: nothing failed to parse, the thing the
    // sidecar claims to describe is not there. Same discipline as the reason
    // vocabulary — a missing input and a malformed one are different findings.
    return refused("artifact-missing", `The provenance sidecar at ${sidecarPath} describes an artifact that is not present at ${artifactPath}.`);
  }
  let sidecar: { corpus?: string; commit?: string; workspace_sha256?: string };
  let bytes: Buffer;
  try {
    sidecar = JSON.parse(readFileSync(sidecarPath, "utf8"));
    bytes = artifactBytes ?? readFileSync(artifactPath);
    // Parsed, not just read. Hashing bytes would succeed on a corrupt file and
    // report `digest-mismatch`, sending a reader to look for provenance drift
    // when the artifact is not JSON at all. Establish that it is an artifact
    // before making claims about which artifact it is.
    JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    return refused("unparseable", `The artifact or its provenance sidecar could not be read (${(e as Error).message}).`);
  }

  const actual = createHash("sha256").update(bytes).digest("hex");
  if (sidecar.workspace_sha256 !== actual) {
    return refused(
      "digest-mismatch",
      `The sidecar describes an artifact with digest ${sidecar.workspace_sha256 ?? "(none)"}, but the artifact hashes to ${actual}. The pair has drifted.`,
    );
  }

  return {
    status: "found",
    repository: sidecar.corpus ?? null,
    revision: sidecar.commit ?? null,
    detail: `Provenance sidecar found and bound to the artifact by digest ${actual.slice(0, 12)}…`,
  };
}

export interface WorkspaceIdentity {
  repository: string | null;
  revision: string | null;
}

export interface WorkspaceEvidence {
  integrity: WorkspaceIntegrity;
  fileIndexKeys: number | null;
  repositoryRelativePath: string | null;
  candidates: string[];
  detail: string;
}

const normaliseRepository = (value: string | null) => value?.replace(/\.git$/, "").replace(/\/$/, "") ?? null;

/**
 * Only an exact repository + immutable revision match permits workspace-derived
 * claims. A dbt path is project-relative, so a unique fileIndex suffix is the
 * sole permitted way to recover its repository-relative path.
 */
export function assessWorkspaceEvidence(
  subject: WorkspaceIdentity,
  artifact: WorkspaceIdentity | null,
  fileIndex: Record<string, unknown> | null,
  dbtFilePath: string | null,
): WorkspaceEvidence {
  if (!artifact || !fileIndex) return {
    integrity: "artifact-unavailable", fileIndexKeys: null, repositoryRelativePath: null, candidates: [],
    detail: "No workspace.json artifact was available for this corpus.",
  };
  if (!subject.repository || !artifact.repository || normaliseRepository(subject.repository) !== normaliseRepository(artifact.repository)) return {
    integrity: "repository-mismatch", fileIndexKeys: Object.keys(fileIndex).length, repositoryRelativePath: null, candidates: [],
    detail: "Workspace artifact repository does not exactly match the subject repository; workspace-derived claims were refused.",
  };
  if (!subject.revision || !artifact.revision || subject.revision !== artifact.revision) return {
    integrity: "revision-mismatch", fileIndexKeys: Object.keys(fileIndex).length, repositoryRelativePath: null, candidates: [],
    detail: "Workspace artifact revision does not exactly match the subject revision; workspace-derived claims were refused.",
  };
  if (!dbtFilePath) return {
    integrity: "path-unresolved", fileIndexKeys: Object.keys(fileIndex).length, repositoryRelativePath: null, candidates: [],
    detail: "DataHub did not expose a dbt model path, so an exact repository path cannot be resolved.",
  };
  const path = dbtFilePath.replace(/^\.\//, "");
  const candidates = Object.keys(fileIndex).filter((key) => key === path || key.endsWith(`/${path}`)).sort();
  if (candidates.length === 0) return {
    integrity: "path-unresolved", fileIndexKeys: Object.keys(fileIndex).length, repositoryRelativePath: null, candidates,
    detail: "No repository-relative workspace fileIndex key resolves the DataHub model path.",
  };
  if (candidates.length !== 1) return {
    integrity: "path-ambiguous", fileIndexKeys: Object.keys(fileIndex).length, repositoryRelativePath: null, candidates,
    detail: "More than one workspace fileIndex key resolves the DataHub model path; an exact source was refused.",
  };
  return {
    integrity: "exact-match", fileIndexKeys: Object.keys(fileIndex).length, repositoryRelativePath: candidates[0]!, candidates,
    detail: "Artifact repository, revision, and repository-relative source path matched exactly.",
  };
}
