import type { FileIndexEntry } from "@workspacejson/spec";

import { normalizeModelPath } from "./normalize.js";

/** A dbt model as read from manifest.json. */
export interface DbtModel {
  uniqueId: string;
  /** `original_file_path` — relative to the dbt project root. */
  originalFilePath: string;
}

/**
 * workspace.json behavioral intelligence, keyed by repository-root-relative
 * POSIX path (per @workspacejson/spec fileIndex, VR-640). Values follow the
 * spec's own FileIndexEntry contract — the join only needs key presence.
 */
export type FileIndex = Record<string, FileIndexEntry>;

export interface JoinRow {
  uniqueId: string;
  originalFilePath: string;
  /** The normalized repo-root-relative key used for lookup. */
  normalizedKey: string;
  matched: boolean;
}

export interface JoinResult {
  rows: JoinRow[];
  matched: number;
  total: number;
}

/**
 * Join dbt models to a workspace.json fileIndex. Each model's project-relative
 * `original_file_path` is normalized to a repo-root-relative key via
 * `projectPrefix`, then looked up by membership. Pass an empty `projectPrefix`
 * to join without normalization (the naive path — correct only when the dbt
 * project sits at the git root).
 */
export function joinModels(
  models: DbtModel[],
  projectPrefix: string,
  fileIndex: FileIndex,
): JoinResult {
  const rows = models.map((m): JoinRow => {
    const normalizedKey = normalizeModelPath(projectPrefix, m.originalFilePath);
    return {
      uniqueId: m.uniqueId,
      originalFilePath: m.originalFilePath,
      normalizedKey,
      matched: Object.prototype.hasOwnProperty.call(fileIndex, normalizedKey),
    };
  });
  return { rows, matched: rows.filter((r) => r.matched).length, total: rows.length };
}
