/**
 * Manifest-node extraction and fileIndex join, end to end, on the frozen proof
 * corpus (HAC-143):
 *
 *   dbt manifest node -> source path -> workspace.json evidence
 *
 * Fixtures are generated from dbt-labs/jaffle_shop_duckdb@36bde6cb by
 * scripts/build-corpus-fixture.mjs and carry their own provenance block.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { computeProjectPrefix, joinModels, type DbtModel, type FileIndex } from "../../../src/adapters/workspacejson/index.js";
import { extractModels } from "../../../src/adapters/workspacejson/dbt.js";
import { extractDatasetNodes, formatDropWarnings } from "../../../src/adapters/workspacejson/nodes.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "../../fixtures/proof-corpus");

const manifest = JSON.parse(readFileSync(join(fixtures, "manifest.json"), "utf8"));
const workspace = JSON.parse(readFileSync(join(fixtures, "workspace.json"), "utf8"));
const workspaceBytes = readFileSync(join(fixtures, "workspace.json"));
const workspaceProvenance = JSON.parse(readFileSync(join(fixtures, "workspace-provenance.json"), "utf8"));
const fileIndex: FileIndex = workspace.generated.fileIndex;

const PINNED = "36bde6cba69d962b83be1d52fc65a0dce1cb4ebb";

describe("fixtures are the frozen corpus", () => {
  it("both fixtures pin the same immutable commit", () => {
    expect(manifest._provenance.commit).toBe(PINNED);
    expect(workspaceProvenance.commit).toBe(PINNED);
    expect(manifest._provenance.dbt_version).toBe("1.12.0");
  });

  it("the workspace fixture is a real producer run, not a synthesized index", () => {
    // Before @workspacejson/cli was published, this fixture was built from
    // `git ls-files` with empty values, because the clean-room rule forbids
    // consuming an unpublished producer from source. It is a genuine
    // `workspacejson generate` run now, and must stay one — a synthesized
    // index would let the join pass against keys no producer ever emitted.
    expect(workspaceProvenance.producer).toMatch(/^@workspacejson\/cli@\d+\.\d+\.\d+$/);
    expect(workspace.generated.by.name).toBe("@workspacejson/cli");
    expect(workspace.generated.specVersion).toBe("0.4");
  });

  it("is schema-valid and cryptographically bound to its external provenance", async () => {
    const { validate, validateV4 } = await import("@workspacejson/spec");
    expect(validate(workspace)).toBe(true);
    expect(validateV4(workspace)).toBe(true);
    expect(workspaceProvenance.workspace_sha256).toBe(
      createHash("sha256").update(workspaceBytes).digest("hex"),
    );
  });

  it("refuses a provenance digest after an artifact-byte violation", () => {
    const tampered = Buffer.concat([workspaceBytes, Buffer.from(" ")]);
    expect(createHash("sha256").update(tampered).digest("hex"))
      .not.toBe(workspaceProvenance.workspace_sha256);
  });

  it("the producer excludes its own artifact, so the index converges", () => {
    // Regression cover for the defect the conformance suite caught upstream:
    // a producer that indexed its own output made `generate --check` fail on a
    // repository's first CI run. A fixture carrying that key would mean the
    // pinned producer had regressed.
    expect(Object.keys(fileIndex)).not.toContain(".agents/workspace.json");
  });
});

describe("node extraction → source path → fileIndex join", () => {
  const result = extractDatasetNodes(manifest);
  const nodes = result.nodes;
  const nodeByUniqueId = new Map(nodes.map((n) => [n.uniqueId, n]));

  // The corpus's dbt project sits AT the repository root, so the prefix is "".
  const prefix = computeProjectPrefix("/repo", "/repo");

  it.each([
    ["model.jaffle_shop.customers", "models/customers.sql"],
    ["model.jaffle_shop.orders", "models/orders.sql"],
    ["model.jaffle_shop.stg_customers", "models/staging/stg_customers.sql"],
    ["model.jaffle_shop.stg_orders", "models/staging/stg_orders.sql"],
    ["model.jaffle_shop.stg_payments", "models/staging/stg_payments.sql"],
  ])("joins %s all the way to a fileIndex hit", (uniqueId, expectedPath) => {
    const node = nodeByUniqueId.get(uniqueId)!;
    expect(node.originalFilePath).toBe(expectedPath);

    const joined = joinModels(
      [{ uniqueId: node.uniqueId, originalFilePath: node.originalFilePath }],
      prefix as string,
      fileIndex,
    );
    expect(joined.matched).toBe(1);
    expect(joined.rows[0]?.normalizedKey).toBe(expectedPath);
  });

  it("joins all five corpus models in one pass", () => {
    const models: DbtModel[] = nodes
      .filter((n) => n.resourceType === "model")
      .map((n) => ({ uniqueId: n.uniqueId, originalFilePath: n.originalFilePath }));

    const joined = joinModels(models, prefix as string, fileIndex);
    expect(joined).toMatchObject({ matched: 5, total: 5 });
  });

  it("joins seeds too — not just models", () => {
    const seed = nodeByUniqueId.get("seed.jaffle_shop.raw_customers")!;
    expect(seed.originalFilePath).toBe("seeds/raw_customers.csv");

    const joined = joinModels(
      [{ uniqueId: seed.uniqueId, originalFilePath: seed.originalFilePath }],
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
    const node = nodeByUniqueId.get("model.jaffle_shop.customers")!;
    const models: DbtModel[] = [{ uniqueId: node.uniqueId, originalFilePath: node.originalFilePath }];

    expect(joinModels(models, "", nestedIndex).matched).toBe(0); // the silent failure
    expect(joinModels(models, "dbt", nestedIndex).matched).toBe(1); // the fix
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
