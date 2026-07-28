/**
 * The DataHub read path, over the official MCP server.
 *
 * This is the layer that turns three MCP tool calls into the context the
 * change-impact event carries. It is deliberately separate from the transport
 * (`mcp-transport.ts`) and from the emitter script: the transport knows about
 * JSON-RPC and nothing about DataHub, this knows about DataHub and nothing about
 * pipes, and the emitter knows about neither beyond calling this.
 *
 * The tools used, and why these three:
 *
 *   get_entities        the dataset itself — name, platform, description,
 *                       customProperties (which is where dbt_file_path and
 *                       dbt_unique_id live), ownership, domain.
 *   get_lineage         upstream and downstream edges, one direction per call.
 *   list_schema_fields  the schema field *count*. `get_entities` can truncate
 *                       the field list, and a truncated list counted as a total
 *                       is a smaller number asserted as the whole answer.
 *
 * What the MCP boundary costs, restated because it is now structural rather than
 * self-imposed: the server's `Dataset` projection carries no `externalUrl`. It
 * is not that this code declines to ask — there is no tool that returns it. So
 * `code.sourceUrl` stays null, no `external-url` resolution is possible, and the
 * writeback states a scoped link omission. HAC-156 is the upstream fix, and
 * `evaluation/mcp-field-coverage.md` holds the measurement.
 *
 * One difference from the direct-GraphQL read that must not be glossed:
 * `get_lineage` compiles `max_hops` into a `degree` filter, where the previous
 * direct query applied no degree constraint at all. Two reads under different
 * hop bounds are not comparable, so the bound travels with the observation
 * rather than being left for a reader to assume. `max_hops: 3` is the server's
 * documented "unlimited", and is what this uses.
 */

import type { McpToolResult } from "./mcp-transport.js";

/** How a tool gets called. Narrow on purpose, so this module is testable without a pipe. */
export type ToolCaller = (name: string, args: Record<string, unknown>) => Promise<McpToolResult>;

/** The tools this read path requires the server to advertise. */
export const REQUIRED_MCP_TOOLS = ["get_entities", "get_lineage", "list_schema_fields"] as const;

/**
 * The hop bound every lineage read here is taken under.
 *
 * 3 is the server's documented equivalent of unlimited: its degree filter maps
 * anything >= 3 to `["1", "2", "3+"]`. Recording the number rather than the word
 * matters because the word is the server's, and if upstream changes what it
 * means the recorded parameter still says what was actually asked.
 */
export const LINEAGE_MAX_HOPS = 3;

/** The result-count ceiling asked of each lineage direction. */
export const LINEAGE_MAX_RESULTS = 50;

export interface LineageEdge {
  urn: string;
  name: string | null;
  degree: number;
}

/**
 * One direction of lineage, with its standing.
 *
 * `read: "failed"` and an empty `edges` are not the same fact and never collapse
 * into each other. A tool that did not answer says so; only a tool that answered
 * is allowed to contribute a count.
 */
export interface LineageRead {
  edges: LineageEdge[];
  read: "ok" | "failed";
  error: string | null;
}

export interface DatasetRead {
  urn: string;
  name: string | null;
  platform: string | null;
  description: string | null;
  customProperties: Record<string, string>;
  owners: string[];
  domain: string | null;
  read: "ok" | "failed";
  error: string | null;
}

export interface SchemaFieldCountRead {
  /** The dataset's total field count — not the length of a returned page. */
  totalFields: number | null;
  read: "ok" | "failed";
  error: string | null;
}

/** The parameters a lineage observation is only comparable under. */
export const LINEAGE_QUERY_PARAMETERS = {
  surface: "mcp:get_lineage",
  query: "*",
  maxHops: LINEAGE_MAX_HOPS,
  maxResults: LINEAGE_MAX_RESULTS,
} as const;

/**
 * Confirm the server advertises every tool this path calls.
 *
 * Checked up front rather than discovered per call, because a missing tool is a
 * property of the server version, not of one dataset. Finding out three calls in
 * would produce an event that is partly a measurement and partly a version
 * complaint, with no way for a reader to tell which fields are which.
 */
export function missingTools(advertised: readonly string[]): string[] {
  return REQUIRED_MCP_TOOLS.filter((required) => !advertised.includes(required));
}

/**
 * Pull the search-result rows out of whatever `get_lineage` returned for one
 * direction.
 *
 * Written to accept the shapes the server is known to produce and to *refuse*
 * anything else, rather than defaulting to `[]`. An unrecognised shape means
 * this code no longer understands the server it is reading, and reporting that
 * as "no edges" would turn a version skew into a positive claim about the
 * catalog — the same collapse the whole contract exists to prevent, arriving
 * through a parser instead of a query.
 */
export function extractLineageRows(payload: unknown, key: "upstreams" | "downstreams"): { rows: unknown[] } | { error: string } {
  if (payload === null || typeof payload !== "object") {
    return { error: `get_lineage returned ${payload === null ? "null" : typeof payload}, not an object` };
  }
  const side = (payload as Record<string, unknown>)[key];
  if (side === undefined) {
    // The server omits the direction it was not asked for; being asked for one
    // and handed neither is a different matter and is reported as such.
    return { error: `get_lineage response carried no "${key}" key` };
  }
  if (Array.isArray(side)) return { rows: side };
  if (side !== null && typeof side === "object") {
    const results = (side as Record<string, unknown>).searchResults;
    if (Array.isArray(results)) return { rows: results };
    // A direction present but carrying no result list at all. `clean_gql_response`
    // drops empty keys, so this is the shape a genuinely empty answer takes.
    if (Object.keys(side as Record<string, unknown>).length === 0) return { rows: [] };
    return { error: `get_lineage "${key}" carried no searchResults array` };
  }
  return { error: `get_lineage "${key}" was ${side === null ? "null" : typeof side}` };
}

/** Turn one lineage row into an edge, or say why it could not be read. */
function toEdge(row: unknown): LineageEdge | null {
  if (row === null || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const entity = (record.entity ?? record) as Record<string, unknown>;
  const urn = entity.urn;
  if (typeof urn !== "string") return null;

  // `name` sits at the top level on some entity types and under `properties` on
  // others. Both are read; neither is invented when absent.
  const properties = entity.properties as Record<string, unknown> | undefined;
  const name =
    (typeof properties?.name === "string" ? properties.name : null) ??
    (typeof entity.name === "string" ? entity.name : null);

  const degree = typeof record.degree === "number" ? record.degree : 1;
  return { urn, name, degree };
}

/**
 * Read one direction of lineage through MCP.
 *
 * `upstream` is the server's own parameter name and polarity: true for
 * upstream, false for downstream. Passed explicitly rather than derived from a
 * direction string, so the call site reads the same as the tool's contract.
 */
export async function readLineage(call: ToolCaller, urn: string, upstream: boolean): Promise<LineageRead> {
  const result = await call("get_lineage", {
    urn,
    upstream,
    max_hops: LINEAGE_MAX_HOPS,
    max_results: LINEAGE_MAX_RESULTS,
    query: LINEAGE_QUERY_PARAMETERS.query,
  });

  if (!result.ok) return { edges: [], read: "failed", error: result.error };

  const key = upstream ? "upstreams" : "downstreams";
  const extracted = extractLineageRows(result.value, key);
  if ("error" in extracted) return { edges: [], read: "failed", error: extracted.error };

  const edges: LineageEdge[] = [];
  let unreadable = 0;
  for (const row of extracted.rows) {
    const edge = toEdge(row);
    if (edge) edges.push(edge);
    else unreadable += 1;
  }

  // A row the parser could not turn into an edge is dropped evidence. Silently
  // shortening the list would understate the catalog's answer, so the read is
  // failed instead: a partial list presented as whole is the defect, not the
  // missing row.
  if (unreadable > 0) {
    return {
      edges: [],
      read: "failed",
      error: `${unreadable} of ${extracted.rows.length} ${key} row(s) carried no readable urn`,
    };
  }

  return { edges, read: "ok", error: null };
}

/** Read the dataset entity through MCP. */
export async function readDataset(call: ToolCaller, urn: string): Promise<DatasetRead> {
  const empty = {
    urn,
    name: null,
    platform: null,
    description: null,
    customProperties: {},
    owners: [],
    domain: null,
  };

  const result = await call("get_entities", { urns: [urn] });
  if (!result.ok) return { ...empty, read: "failed", error: result.error };

  // The tool returns a list for a list of URNs, and a bare object for a single
  // URN string. One URN is passed as a list, so a list is what is expected —
  // but both are accepted rather than making the shape a silent assumption.
  const payload = Array.isArray(result.value) ? result.value[0] : result.value;
  if (payload === null || typeof payload !== "object") {
    return { ...empty, read: "failed", error: "get_entities returned no entity object" };
  }

  const entity = payload as Record<string, unknown>;
  if (typeof entity.error === "string") {
    return { ...empty, read: "failed", error: `get_entities: ${entity.error}` };
  }

  const properties = (entity.properties ?? {}) as Record<string, unknown>;

  // customProperties arrives as a list of {key, value} pairs. A map is what
  // every caller wants, and building it here keeps the shape assumption in one
  // place instead of at each read site.
  const customProperties: Record<string, string> = {};
  const rawCustom = properties.customProperties;
  if (Array.isArray(rawCustom)) {
    for (const pair of rawCustom) {
      if (pair === null || typeof pair !== "object") continue;
      const { key, value } = pair as Record<string, unknown>;
      if (typeof key === "string" && typeof value === "string") customProperties[key] = value;
    }
  } else if (rawCustom !== null && typeof rawCustom === "object") {
    for (const [key, value] of Object.entries(rawCustom as Record<string, unknown>)) {
      if (typeof value === "string") customProperties[key] = value;
    }
  }

  const ownership = (entity.ownership ?? {}) as Record<string, unknown>;
  const owners: string[] = [];
  if (Array.isArray(ownership.owners)) {
    for (const entry of ownership.owners) {
      const owner = (entry as Record<string, unknown> | null)?.owner as Record<string, unknown> | undefined;
      if (typeof owner?.urn === "string") owners.push(owner.urn);
    }
  }

  const domainWrapper = (entity.domain ?? null) as Record<string, unknown> | null;
  const domainEntity = (domainWrapper?.domain ?? null) as Record<string, unknown> | null;
  const domain = typeof domainEntity?.urn === "string" ? domainEntity.urn : null;

  const platformEntity = (entity.platform ?? null) as Record<string, unknown> | null;
  const platformProperties = (platformEntity?.properties ?? null) as Record<string, unknown> | null;
  const platform =
    (typeof platformEntity?.name === "string" ? platformEntity.name : null) ??
    (typeof platformProperties?.displayName === "string" ? platformProperties.displayName : null);

  return {
    urn: typeof entity.urn === "string" ? entity.urn : urn,
    name:
      (typeof properties.name === "string" ? properties.name : null) ??
      (typeof entity.name === "string" ? entity.name : null),
    platform,
    description: typeof properties.description === "string" ? properties.description : null,
    customProperties,
    owners,
    domain,
    read: "ok",
    error: null,
  };
}

/**
 * Read the dataset's schema field count through MCP.
 *
 * `totalFields` is used rather than the length of `fields`, because the tool
 * paginates and applies a token budget: the returned page can be shorter than
 * the schema. Counting the page would publish a number that is smaller than the
 * truth and indistinguishable from it.
 */
export async function readSchemaFieldCount(call: ToolCaller, urn: string): Promise<SchemaFieldCountRead> {
  const result = await call("list_schema_fields", { urn, limit: 1 });
  if (!result.ok) return { totalFields: null, read: "failed", error: result.error };

  const payload = result.value;
  if (payload === null || typeof payload !== "object") {
    return { totalFields: null, read: "failed", error: "list_schema_fields returned no object" };
  }
  const total = (payload as Record<string, unknown>).totalFields;
  if (typeof total !== "number") {
    return { totalFields: null, read: "failed", error: "list_schema_fields returned no totalFields count" };
  }
  return { totalFields: total, read: "ok", error: null };
}
