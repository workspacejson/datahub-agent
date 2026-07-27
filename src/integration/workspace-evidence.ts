/**
 * Corpus-safe workspace.json selection for the judge event.  This is kept out
 * of the CLI script so the refusal behaviour is executable and testable.
 */
export type WorkspaceIntegrity = "exact-match" | "artifact-unavailable" | "repository-mismatch" | "revision-mismatch" | "path-unresolved" | "path-ambiguous";

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
