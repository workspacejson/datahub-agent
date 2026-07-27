import { relative, sep } from "node:path";

/** Convert an OS-native path to canonical POSIX (forward slashes). No-op on POSIX. */
export function toPosix(p: string): string {
  return sep === "\\" ? p.replace(/\\/g, "/") : p;
}

/** Canonical form: POSIX separators, no leading "./", no trailing slash. */
export function canonical(p: string): string {
  return toPosix(p)
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

/**
 * The repository-root-relative POSIX prefix from the git root to a dbt project
 * directory. Empty string when the dbt project IS the git root (the control
 * layout where dbt's `original_file_path` already matches the workspace.json key).
 *
 * Returns null when `dbtProjectDir` is not inside `gitRoot` (relative path
 * escapes upward) — a caller that gets null must not attempt the join, since no
 * repo-root-relative key can be derived.
 */
export function computeProjectPrefix(gitRoot: string, dbtProjectDir: string): string | null {
  const rel = canonical(relative(gitRoot, dbtProjectDir));
  if (rel === ".." || rel.startsWith("../")) return null;
  return rel;
}

/**
 * Normalize a dbt `original_file_path` (relative to the dbt project root) into
 * the canonical workspace.json fileIndex key: repository-root-relative POSIX
 * (VR-640). This is the entire DataHub join fix — prepend the project prefix so
 * a nested dbt project's model paths line up with git-root-relative keys.
 */
export function normalizeModelPath(projectPrefix: string, originalFilePath: string): string {
  const rel = canonical(originalFilePath);
  return projectPrefix ? `${projectPrefix}/${rel}` : rel;
}
