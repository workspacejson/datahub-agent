/**
 * HAC-147 seam, end to end, on the frozen proof corpus (HAC-143):
 *
 *   DataHub dataset URN -> dbt model -> source path -> workspace.json evidence
 *
 * META-248 calls this out as the test the adopted adapter did not have: it
 * covered `dbt -> fileIndex` but never `URN -> dbt`. Fixtures are generated
 * from dbt-labs/jaffle_shop_duckdb@36bde6cb by scripts/build-corpus-fixture.mjs
 * and carry their own provenance block.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { computeProjectPrefix, joinModels, type DbtModel, type FileIndex } from "../../../src/adapters/workspacejson/index.js";
import { extractModels } from "../../../src/adapters/workspacejson/dbt.js";
import { extractDatasetNodes, formatDropWarnings } from "../../../src/adapters/workspacejson/nodes.js";
import { indexNodesByDatasetName, parseDatasetUrn, resolveUrn } from "../../../src/adapters/workspacejson/urn.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "../../fixtures/proof-corpus");

const manifest = JSON.parse(readFileSync(join(fixtures, "manifest.json"), "utf8"));
const workspace = JSON.parse(readFileSync(join(fixtures, "workspace.json"), "utf8"));
const fileIndex: FileIndex = workspace.generated.fileIndex;

const PINNED = "36bde6cba69d962b83be1d52fc65a0dce1cb4ebb";
const urnFor = (name: string) => `urn:li:dataset:(urn:li:dataPlatform:dbt,jaffle_shop.main.${name},PROD)`;

describe("fixtures are the frozen corpus", () => {
  it("both fixtures pin the same immutable commit", () => {
    expect(manifest._provenance.commit).toBe(PINNED);
    expect(workspace._provenance.commit).toBe(PINNED);
    expect(manifest._provenance.dbt_version).toBe("1.12.0");
  });
});

describe("URN parsing", () => {
  it("parses a dbt dataset URN into platform, name and fabric", () => {
    expect(parseDatasetUrn(urnFor("customers"))).toEqual({
      platform: "dbt",
      name: "jaffle_shop.main.customers",
      fabric: "PROD",
    });
  });

  it.each([
    ["not a urn at all", "not-a-urn"],
    ["a chart urn, not a dataset", "urn:li:chart:(looker,baz)"],
    ["a truncated dataset urn", "urn:li:dataset:(urn:li:dataPlatform:dbt,only.two)"],
  ])("returns null for %s", (_label, urn) => {
    expect(parseDatasetUrn(urn)).toBeNull();
  });
});

describe("URN -> dbt model -> source path -> fileIndex (the full seam)", () => {
  const index = indexNodesByDatasetName(manifest.nodes);

  // The corpus's dbt project sits AT the repository root, so the prefix is "".
  const prefix = computeProjectPrefix("/repo", "/repo");

  it.each([
    ["customers", "models/customers.sql"],
    ["orders", "models/orders.sql"],
    ["stg_customers", "models/staging/stg_customers.sql"],
    ["stg_orders", "models/staging/stg_orders.sql"],
    ["stg_payments", "models/staging/stg_payments.sql"],
  ])("resolves %s all the way to a fileIndex hit", (name, expectedPath) => {
    const resolution = resolveUrn(urnFor(name), index);

    expect(resolution.failure).toBeNull();
    expect(resolution.uniqueId).toBe(`model.jaffle_shop.${name}`);
    expect(resolution.originalFilePath).toBe(expectedPath);

    const joined = joinModels(
      [{ uniqueId: resolution.uniqueId!, originalFilePath: resolution.originalFilePath! }],
      prefix as string,
      fileIndex,
    );
    expect(joined.matched).toBe(1);
    expect(joined.rows[0]?.normalizedKey).toBe(expectedPath);
  });

  it("joins all five corpus models in one pass", () => {
    const models: DbtModel[] = ["customers", "orders", "stg_customers", "stg_orders", "stg_payments"]
      .map((n) => resolveUrn(urnFor(n), index))
      .map((r) => ({ uniqueId: r.uniqueId!, originalFilePath: r.originalFilePath! }));

    const joined = joinModels(models, prefix as string, fileIndex);
    expect(joined).toMatchObject({ matched: 5, total: 5 });
  });

  it("resolves seeds too — not just models", () => {
    const resolution = resolveUrn(urnFor("raw_customers"), index);
    expect(resolution.failure).toBeNull();
    expect(resolution.uniqueId).toBe("seed.jaffle_shop.raw_customers");
    expect(resolution.originalFilePath).toBe("seeds/raw_customers.csv");

    const joined = joinModels(
      [{ uniqueId: resolution.uniqueId!, originalFilePath: resolution.originalFilePath! }],
      prefix as string,
      fileIndex,
    );
    expect(joined.matched).toBe(1);
  });

  it("PERTURBED: a nested dbt project still joins once the prefix is applied", () => {
    // The corpus is root-level, so the nested case — the entire reason the
    // shim exists — is exercised by relocating the same real paths under a
    // prefix and rebuilding the index the producer would emit.
    const nestedIndex: FileIndex = Object.fromEntries(
      Object.keys(fileIndex).map((k) => [`dbt/${k}`, {}]),
    );
    const model = resolveUrn(urnFor("customers"), index);
    const models: DbtModel[] = [{ uniqueId: model.uniqueId!, originalFilePath: model.originalFilePath! }];

    expect(joinModels(models, "", nestedIndex).matched).toBe(0); // the silent failure
    expect(joinModels(models, "dbt", nestedIndex).matched).toBe(1); // the fix
  });

  it.each([
    ["unparseable-urn", "garbage"],
    ["non-dbt-platform", "urn:li:dataset:(urn:li:dataPlatform:snowflake,a.b.c,PROD)"],
    ["no-matching-node", urnFor("does_not_exist")],
  ])("reports %s explicitly rather than returning nothing", (failure, urn) => {
    const r = resolveUrn(urn, index);
    expect(r.failure).toBe(failure);
    expect(r.uniqueId).toBeNull();
  });
});

describe("HAC-162: dropped nodes warn, they do not vanish", () => {
  it("the adopted extractModels silently discards 23 of the corpus's 28 nodes", () => {
    // Not a defect being fixed in place — this is the pinned parity behavior
    // (META-248, 35/35). Asserted so the contrast below is anchored in fact.
    const total = Object.keys(manifest.nodes).length;
    expect(total).toBe(28);
    expect(extractModels(manifest)).toHaveLength(5);
  });

  it("extractDatasetNodes accounts for every node — nothing disappears", () => {
    const r = extractDatasetNodes(manifest);
    const excluded = Object.values(r.excluded).reduce((a, b) => a + b, 0);

    expect(r.total).toBe(28);
    expect(r.nodes).toHaveLength(8); // 5 models + 3 seeds
    expect(r.dropped).toHaveLength(0);
    expect(r.excluded).toEqual({ test: 20 });
    expect(r.nodes.length + r.dropped.length + excluded).toBe(r.total);
  });

  it("widens beyond models: the 3 corpus seeds are extracted, not discarded", () => {
    const seeds = extractDatasetNodes(manifest).nodes.filter((n) => n.resourceType === "seed");
    expect(seeds.map((s) => s.originalFilePath).sort()).toEqual([
      "seeds/raw_customers.csv",
      "seeds/raw_orders.csv",
      "seeds/raw_payments.csv",
    ]);
  });

  it("a dataset-bearing node with no original_file_path is DROPPED AND WARNED", () => {
    const withNull = {
      nodes: {
        ...manifest.nodes,
        "snapshot.jaffle_shop.broken": {
          resource_type: "snapshot",
          unique_id: "snapshot.jaffle_shop.broken",
          original_file_path: null,
        },
      },
    };

    const r = extractDatasetNodes(withNull);
    expect(r.dropped).toEqual([
      {
        uniqueId: "snapshot.jaffle_shop.broken",
        resourceType: "snapshot",
        reason: "missing-original-file-path",
      },
    ]);

    const warnings = formatDropWarnings(r);
    expect(warnings.join("\n")).toContain("snapshot.jaffle_shop.broken");
    expect(warnings[0]).toMatch(/^WARNING: 1 dataset-bearing dbt node/);
  });

  it("emits no warnings when nothing was dropped", () => {
    expect(formatDropWarnings(extractDatasetNodes(manifest))).toEqual([]);
  });
});
