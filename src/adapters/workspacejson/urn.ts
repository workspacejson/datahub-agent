/**
 * DataHub dataset URN -> dbt manifest node resolution.
 *
 * This is the first half of the HAC-147 seam. The adopted adapter (META-248)
 * covers `dbt model -> source path -> fileIndex`; it had no URN handling at
 * all. This module supplies `dataset URN -> dbt model`, so the full chain
 * `URN -> dbt model -> source path -> workspace.json evidence` closes.
 *
 * DataHub's dbt ingestion emits dataset URNs of the form:
 *
 *   urn:li:dataset:(urn:li:dataPlatform:dbt,<database>.<schema>.<name>,<FABRIC>)
 *
 * The middle segment is the dbt node's fully-qualified relation, which is
 * reconstructible from `manifest.json` as `database.schema.alias`.
 */

/** A parsed DataHub dataset URN. */
export interface DatasetUrn {
  /** Platform key, e.g. "dbt", "snowflake", "duckdb". */
  platform: string;
  /** Dataset name, e.g. "jaffle_shop.main.customers". */
  name: string;
  /** Fabric / environment, e.g. "PROD". */
  fabric: string;
}

const DATASET_URN = /^urn:li:dataset:\((urn:li:dataPlatform:[^,)]+),([^,)]+),([^,)]+)\)$/;
const PLATFORM_URN = /^urn:li:dataPlatform:(.+)$/;

/**
 * Parse a DataHub dataset URN.
 *
 * Returns null for anything that is not a well-formed dataset URN. Callers
 * must treat null as a reportable condition, never as an empty result — a URN
 * that fails to parse is a node that will silently vanish from the join
 * otherwise, which is precisely the failure mode HAC-162 prohibits.
 */
export function parseDatasetUrn(urn: string): DatasetUrn | null {
  const m = DATASET_URN.exec(urn.trim());
  if (!m) return null;
  const [, platformUrn, name, fabric] = m;
  const p = PLATFORM_URN.exec(platformUrn ?? "");
  if (!p?.[1] || !name || !fabric) return null;
  return { platform: p[1], name, fabric };
}

/**
 * The dataset name DataHub uses for a dbt node: `database.schema.alias`.
 *
 * dbt's `relation_name` carries adapter-specific quoting (`"db"."schema"."x"`),
 * so the components are assembled from the discrete fields instead of being
 * parsed back out of the quoted string.
 */
export function datasetNameForNode(node: {
  database?: string | undefined;
  schema?: string | undefined;
  alias?: string | undefined;
  name?: string | undefined;
}): string | null {
  const relation = node.alias ?? node.name;
  if (!node.database || !node.schema || !relation) return null;
  return `${node.database}.${node.schema}.${relation}`;
}

/** Reason a URN could not be resolved to a dbt node. */
export type UrnResolutionFailure =
  | "unparseable-urn"
  | "non-dbt-platform"
  | "no-matching-node";

export interface UrnResolution {
  urn: string;
  /** dbt `unique_id` when resolved, else null. */
  uniqueId: string | null;
  /** Populated only on success. */
  originalFilePath: string | null;
  /** Populated only on failure — never silently absent. */
  failure: UrnResolutionFailure | null;
}

interface ResolvableNode {
  unique_id?: string | undefined;
  database?: string | undefined;
  schema?: string | undefined;
  alias?: string | undefined;
  name?: string | undefined;
  original_file_path?: string | undefined;
}

/**
 * Build a `datasetName -> node` lookup from a parsed manifest's `.nodes`.
 * Nodes that cannot produce a dataset name are omitted from the index; the
 * caller surfaces them via `resolveUrn`'s `no-matching-node` failure rather
 * than by their absence.
 */
export function indexNodesByDatasetName(
  nodes: Record<string, ResolvableNode>,
): Map<string, ResolvableNode> {
  const index = new Map<string, ResolvableNode>();
  for (const node of Object.values(nodes)) {
    const name = datasetNameForNode(node);
    if (name) index.set(name, node);
  }
  return index;
}

/**
 * Resolve a DataHub dataset URN to the dbt node it names.
 *
 * Every outcome is explicit: a resolution either carries a `uniqueId` and an
 * `originalFilePath`, or it carries a `failure`. There is no shape in which a
 * URN quietly produces nothing.
 */
export function resolveUrn(urn: string, index: Map<string, ResolvableNode>): UrnResolution {
  const base: UrnResolution = { urn, uniqueId: null, originalFilePath: null, failure: null };
  const parsed = parseDatasetUrn(urn);
  if (!parsed) return { ...base, failure: "unparseable-urn" };
  if (parsed.platform !== "dbt") return { ...base, failure: "non-dbt-platform" };
  const node = index.get(parsed.name);
  if (!node) return { ...base, failure: "no-matching-node" };
  return {
    urn,
    uniqueId: node.unique_id ?? null,
    originalFilePath: node.original_file_path ?? null,
    failure: null,
  };
}
