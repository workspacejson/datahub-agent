import { describe, expect, it } from "vitest";
import type { McpToolResult } from "../../src/integration/mcp-transport.js";
import {
  LINEAGE_MAX_HOPS,
  LINEAGE_MAX_RESULTS,
  extractLineageRows,
  missingTools,
  readDataset,
  readLineage,
  readSchemaFieldCount,
} from "../../src/integration/mcp-read.js";

/** A caller that answers one tool and records what it was asked. */
function caller(
  answers: Record<string, McpToolResult>,
  seen: Array<{ name: string; args: Record<string, unknown> }> = [],
) {
  return {
    seen,
    call: async (name: string, args: Record<string, unknown>): Promise<McpToolResult> => {
      seen.push({ name, args });
      return answers[name] ?? { ok: false, value: null, error: `no stub for ${name}` };
    },
  };
}

const ok = (value: unknown): McpToolResult => ({ ok: true, value, error: null });
const failed = (error: string): McpToolResult => ({ ok: false, value: null, error });

describe("required tool surface", () => {
  it("names every tool the read path calls but the server does not advertise", () => {
    expect(missingTools(["get_entities", "search"])).toEqual(["get_lineage", "list_schema_fields"]);
  });

  it("reports nothing missing when the server advertises the full set", () => {
    expect(missingTools(["search", "get_entities", "get_lineage", "list_schema_fields"])).toEqual([]);
  });
});

describe("lineage row extraction", () => {
  it("reads the searchResults array the server wraps a direction in", () => {
    const extracted = extractLineageRows({ upstreams: { searchResults: [{ entity: { urn: "urn:a" } }] } }, "upstreams");
    expect(extracted).toEqual({ rows: [{ entity: { urn: "urn:a" } }] });
  });

  it("treats a direction stripped to an empty object as an empty answer", () => {
    // `clean_gql_response` drops empty keys, so this is the shape a genuinely
    // empty direction arrives in — distinct from a shape this code cannot read.
    expect(extractLineageRows({ downstreams: {} }, "downstreams")).toEqual({ rows: [] });
  });

  it("refuses a shape it does not recognise instead of reporting no edges", () => {
    // The defect this exists to refuse: an unreadable response becoming a
    // positive claim that the catalog holds nothing.
    const extracted = extractLineageRows({ upstreams: { total: 4 } }, "upstreams");
    expect(extracted).toHaveProperty("error");
    expect(extracted).not.toHaveProperty("rows");
  });

  it("refuses a response missing the direction it was asked for", () => {
    expect(extractLineageRows({ downstreams: { searchResults: [] } }, "upstreams")).toHaveProperty("error");
  });

  it("refuses a non-object payload rather than defaulting to empty", () => {
    expect(extractLineageRows(null, "upstreams")).toHaveProperty("error");
    expect(extractLineageRows("upstreams", "upstreams")).toHaveProperty("error");
  });
});

describe("reading one direction of lineage", () => {
  it("asks under the recorded hop bound and result ceiling", async () => {
    const stub = caller({ get_lineage: ok({ upstreams: { searchResults: [] } }) });
    await readLineage(stub.call, "urn:li:dataset:x", true);
    expect(stub.seen[0]?.args).toMatchObject({
      urn: "urn:li:dataset:x",
      upstream: true,
      max_hops: LINEAGE_MAX_HOPS,
      max_results: LINEAGE_MAX_RESULTS,
    });
  });

  it("asks for downstream with the server's own polarity", async () => {
    const stub = caller({ get_lineage: ok({ downstreams: { searchResults: [] } }) });
    await readLineage(stub.call, "urn:li:dataset:x", false);
    expect(stub.seen[0]?.args).toMatchObject({ upstream: false });
  });

  it("records a failed call as failed, never as zero edges", async () => {
    const stub = caller({ get_lineage: failed("tool get_lineage reported an error: boom") });
    const read = await readLineage(stub.call, "urn:li:dataset:x", true);
    expect(read.read).toBe("failed");
    expect(read.error).toContain("boom");
    expect(read.edges).toEqual([]);
  });

  it("reads urn, name and degree from a row", async () => {
    const stub = caller({
      get_lineage: ok({
        upstreams: {
          searchResults: [
            { degree: 2, entity: { urn: "urn:a", properties: { name: "customers" } } },
            { entity: { urn: "urn:b", name: "orders" } },
          ],
        },
      }),
    });
    const read = await readLineage(stub.call, "urn:li:dataset:x", true);
    expect(read.read).toBe("ok");
    expect(read.edges).toEqual([
      { urn: "urn:a", name: "customers", degree: 2 },
      { urn: "urn:b", name: "orders", degree: 1 },
    ]);
  });

  it("fails rather than silently returning a shortened edge list", async () => {
    // Dropping the unreadable row would understate the catalog's answer while
    // looking exactly like a complete one.
    const stub = caller({
      get_lineage: ok({ upstreams: { searchResults: [{ entity: { urn: "urn:a" } }, { entity: {} }] } }),
    });
    const read = await readLineage(stub.call, "urn:li:dataset:x", true);
    expect(read.read).toBe("failed");
    expect(read.error).toContain("1 of 2");
    expect(read.edges).toEqual([]);
  });
});

describe("reading the dataset entity", () => {
  const entity = {
    urn: "urn:li:dataset:x",
    name: "customers",
    platform: { name: "dbt" },
    properties: {
      name: "customers",
      description: "one row per customer",
      customProperties: [
        { key: "dbt_file_path", value: "models/customers.sql" },
        { key: "dbt_unique_id", value: "model.jaffle_shop.customers" },
      ],
    },
    ownership: { owners: [{ owner: { urn: "urn:li:corpuser:alice" } }] },
    domain: { domain: { urn: "urn:li:domain:analytics" } },
  };

  it("flattens customProperties into the map the join reads", async () => {
    const stub = caller({ get_entities: ok([entity]) });
    const read = await readDataset(stub.call, "urn:li:dataset:x");
    expect(read.read).toBe("ok");
    expect(read.customProperties.dbt_file_path).toBe("models/customers.sql");
    expect(read.customProperties.dbt_unique_id).toBe("model.jaffle_shop.customers");
  });

  it("reads platform, description, owners and domain", async () => {
    const stub = caller({ get_entities: ok([entity]) });
    const read = await readDataset(stub.call, "urn:li:dataset:x");
    expect(read.platform).toBe("dbt");
    expect(read.description).toBe("one row per customer");
    expect(read.owners).toEqual(["urn:li:corpuser:alice"]);
    expect(read.domain).toBe("urn:li:domain:analytics");
  });

  it("accepts a bare object as well as a single-element list", async () => {
    const stub = caller({ get_entities: ok(entity) });
    expect((await readDataset(stub.call, "urn:li:dataset:x")).name).toBe("customers");
  });

  it("records the tool's own not-found report as a failed read", async () => {
    const stub = caller({ get_entities: ok([{ error: "Entity urn:li:dataset:x not found", urn: "urn:li:dataset:x" }]) });
    const read = await readDataset(stub.call, "urn:li:dataset:x");
    expect(read.read).toBe("failed");
    expect(read.error).toContain("not found");
  });

  it("does not report a failed call as a dataset with empty fields", async () => {
    const stub = caller({ get_entities: failed("get_entities timed out after 60000ms") });
    const read = await readDataset(stub.call, "urn:li:dataset:x");
    expect(read.read).toBe("failed");
    expect(read.customProperties).toEqual({});
    expect(read.name).toBeNull();
  });
});

describe("reading the schema field count", () => {
  it("takes the total, not the length of the returned page", async () => {
    // The page is deliberately shorter than the schema. Counting it would
    // publish a smaller number indistinguishable from the true one.
    const stub = caller({ get_entities: ok({}), list_schema_fields: ok({ totalFields: 7, fields: [{ fieldPath: "id" }], returned: 1 }) });
    const read = await readSchemaFieldCount(stub.call, "urn:li:dataset:x");
    expect(read.read).toBe("ok");
    expect(read.totalFields).toBe(7);
  });

  it("fails when the tool returns no total rather than assuming zero", async () => {
    const stub = caller({ list_schema_fields: ok({ fields: [] }) });
    const read = await readSchemaFieldCount(stub.call, "urn:li:dataset:x");
    expect(read.read).toBe("failed");
    expect(read.totalFields).toBeNull();
  });

  it("records a failed call as failed", async () => {
    const stub = caller({ list_schema_fields: failed("no stub") });
    expect((await readSchemaFieldCount(stub.call, "urn:li:dataset:x")).read).toBe("failed");
  });
});
