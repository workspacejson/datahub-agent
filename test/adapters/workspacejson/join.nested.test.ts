import { describe, expect, it } from "vitest";

import { computeProjectPrefix, joinModels, type DbtModel, type FileIndex } from "../../../src/adapters/workspacejson/index.js";

// ─── Fixtures from the HAC-75 join probe ─────────────────────────────────────
// jaffle_shop_duckdb's five models. `originalFilePath` is exactly what dbt's
// manifest.json reports (relative to the dbt project root) — identical whether
// the project sits at the repo root or nested under dbt/.
const MODELS: DbtModel[] = [
  { uniqueId: "model.jaffle_shop.customers", originalFilePath: "models/customers.sql" },
  { uniqueId: "model.jaffle_shop.orders", originalFilePath: "models/orders.sql" },
  { uniqueId: "model.jaffle_shop.stg_customers", originalFilePath: "models/staging/stg_customers.sql" },
  { uniqueId: "model.jaffle_shop.stg_payments", originalFilePath: "models/staging/stg_payments.sql" },
  { uniqueId: "model.jaffle_shop.stg_orders", originalFilePath: "models/staging/stg_orders.sql" },
];

// workspace.json fileIndex as the REAL Vreko emitter produced it on the nested
// repo (git-root-relative keys, observed in the HAC-75 probe): dbt/ prefix.
const NESTED_FILE_INDEX: FileIndex = {
  "dbt/models/customers.sql": {},
  "dbt/models/orders.sql": {},
  "dbt/models/staging/stg_customers.sql": {},
  "dbt/models/staging/stg_payments.sql": {},
  "dbt/models/staging/stg_orders.sql": {},
};

// Control layout: dbt project AT the git root, so keys carry no prefix.
const ROOT_FILE_INDEX: FileIndex = {
  "models/customers.sql": {},
  "models/orders.sql": {},
  "models/staging/stg_customers.sql": {},
  "models/staging/stg_payments.sql": {},
  "models/staging/stg_orders.sql": {},
};

describe("DataHub join — nested dbt project (HAC-75 treatment)", () => {
  it("RED: naive join (original_file_path used directly) matches 0/5", () => {
    // No normalization — the failure the probe reproduced. This is the guard:
    // if the shim were a no-op, the join silently returns zero rows.
    const naive = joinModels(MODELS, "", NESTED_FILE_INDEX);
    expect(naive.matched).toBe(0);
    expect(naive.rows.every((r) => !r.matched)).toBe(true);
  });

  it("GREEN: shim join (repo-root-relative normalization) matches 5/5", () => {
    const prefix = computeProjectPrefix("/repo", "/repo/dbt");
    expect(prefix).toBe("dbt");
    const joined = joinModels(MODELS, prefix as string, NESTED_FILE_INDEX);
    expect(joined.matched).toBe(5);
    expect(joined.rows.every((r) => r.matched)).toBe(true);
    expect(joined.rows[0]?.normalizedKey).toBe("dbt/models/customers.sql");
  });

  it("control: dbt project at git root joins 5/5 with an empty prefix", () => {
    const prefix = computeProjectPrefix("/repo", "/repo");
    expect(prefix).toBe("");
    const joined = joinModels(MODELS, prefix as string, ROOT_FILE_INDEX);
    expect(joined.matched).toBe(5);
  });

  it("rejects a dbt project outside the git root (no derivable key)", () => {
    expect(computeProjectPrefix("/repo/dbt", "/repo")).toBeNull();
  });
});

describe("joinModels edge cases", () => {
  it("returns zero matched for an empty models array", () => {
    const result = joinModels([], "dbt", NESTED_FILE_INDEX);
    expect(result.matched).toBe(0);
    expect(result.total).toBe(0);
    expect(result.rows).toEqual([]);
  });

  it("returns zero matched when the fileIndex is empty", () => {
    const result = joinModels(MODELS, "dbt", {});
    expect(result.matched).toBe(0);
    expect(result.total).toBe(5);
    expect(result.rows.every((r) => !r.matched)).toBe(true);
  });

  it("reports a partial match when only some models resolve", () => {
    const partialIndex: FileIndex = {
      "dbt/models/customers.sql": {},
      "dbt/models/orders.sql": {},
    };
    const result = joinModels(MODELS, "dbt", partialIndex);
    expect(result.matched).toBe(2);
    expect(result.total).toBe(5);
    const matched = result.rows.filter((r) => r.matched);
    const unmatched = result.rows.filter((r) => !r.matched);
    expect(matched.map((r) => r.uniqueId)).toEqual(["model.jaffle_shop.customers", "model.jaffle_shop.orders"]);
    expect(unmatched).toHaveLength(3);
  });
});
