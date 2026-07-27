/**
 * Non-silent dbt node extraction (HAC-162).
 *
 * The adopted `extractModels` (dbt.ts) filters `resource_type === "model"` and
 * additionally requires a truthy `original_file_path`. Both filters are silent:
 * no warning, no count, no exit code. Measured against the frozen proof corpus
 * that discards 23 of 28 nodes without a word, and against the node-type probe
 * it discards exactly the snapshot and seed HAC-162 exists to protect.
 *
 * HAC-162's bar: "Do not let the join swallow a null original_file_path. A
 * dropped node must warn, not vanish."
 *
 * `extractModels` is deliberately left untouched — it is the behavior the
 * META-248 parity harness pins at 35/35. This module is the widened,
 * accountable path that the DataHub join actually uses.
 *
 * The two exclusion kinds are reported separately because they mean different
 * things:
 *
 *   excluded  — the node is not a dataset-bearing kind (a dbt test, an
 *               analysis). Expected, by policy, and merely counted.
 *   dropped   — the node IS dataset-bearing but has no `original_file_path`,
 *               so it has no file to score. Unexpected, and warned.
 */

/** dbt node kinds DataHub materializes as datasets, and that map to a file. */
export const DATASET_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  "model",
  "seed",
  "snapshot",
]);

export interface ExtractedNode {
  uniqueId: string;
  resourceType: string;
  originalFilePath: string;
  /** "sql" | "python" for models; undefined for seeds. */
  language: string | undefined;
}

export interface DroppedNode {
  uniqueId: string;
  resourceType: string;
  reason: "missing-original-file-path";
}

export interface ExtractionResult {
  nodes: ExtractedNode[];
  /** Dataset-bearing nodes with no resolvable file. Must be surfaced. */
  dropped: DroppedNode[];
  /** Non-dataset node kinds, counted by resource_type. Expected. */
  excluded: Record<string, number>;
  /** Total nodes seen in `.nodes`, so the arithmetic is checkable. */
  total: number;
}

interface RawNode {
  resource_type?: string | undefined;
  unique_id?: string | undefined;
  original_file_path?: string | undefined;
  language?: string | undefined;
}

/**
 * Extract every dataset-bearing dbt node, accounting for all of them.
 *
 * The invariant callers can rely on:
 *
 *   nodes.length + dropped.length + sum(excluded) === total
 *
 * Nothing disappears between the manifest and the result.
 */
export function extractDatasetNodes(
  manifest: { nodes?: Record<string, RawNode> | undefined },
  resourceTypes: ReadonlySet<string> = DATASET_RESOURCE_TYPES,
): ExtractionResult {
  const nodes: ExtractedNode[] = [];
  const dropped: DroppedNode[] = [];
  const excluded: Record<string, number> = {};
  let total = 0;

  for (const node of Object.values(manifest.nodes ?? {})) {
    total += 1;
    const resourceType = node.resource_type ?? "unknown";

    if (!resourceTypes.has(resourceType)) {
      excluded[resourceType] = (excluded[resourceType] ?? 0) + 1;
      continue;
    }

    const uniqueId = node.unique_id ?? node.original_file_path ?? "<unidentified>";

    if (!node.original_file_path) {
      dropped.push({ uniqueId, resourceType, reason: "missing-original-file-path" });
      continue;
    }

    nodes.push({
      uniqueId,
      resourceType,
      originalFilePath: node.original_file_path,
      language: node.language,
    });
  }

  return { nodes, dropped, excluded, total };
}

/**
 * Render dropped nodes as warning lines. Empty when nothing was dropped, so a
 * caller can `for (const line of warnings) console.warn(line)` unconditionally.
 */
export function formatDropWarnings(result: ExtractionResult): string[] {
  if (result.dropped.length === 0) return [];
  const byType = new Map<string, number>();
  for (const d of result.dropped) byType.set(d.resourceType, (byType.get(d.resourceType) ?? 0) + 1);
  const summary = [...byType.entries()].map(([t, n]) => `${t}: ${n}`).join(", ");
  return [
    `WARNING: ${result.dropped.length} dataset-bearing dbt node(s) have no original_file_path (${summary}).`,
    "These have no source file to score and are absent from the join. They were NOT silently discarded:",
    ...result.dropped.map((d) => `  [dropped] ${d.resourceType}  ${d.uniqueId}  (${d.reason})`),
  ];
}
