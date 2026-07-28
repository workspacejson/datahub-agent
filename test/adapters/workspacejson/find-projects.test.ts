import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { findDbtProjects, extractModels, type DbtManifest } from "../../../src/adapters/workspacejson/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const MULTI = resolve(here, "fixtures/multi");

describe("VR-640 multi-project guard: findDbtProjects", () => {
  it("enumerates every dbt_project.yml, not just the first", () => {
    const projects = findDbtProjects(MULTI).map((p) => p.slice(MULTI.length + 1));
    expect(projects).toEqual(["analytics", "sub/warehouse"]);
  });

  it("returns an empty list for a tree with no dbt projects", () => {
    expect(findDbtProjects(resolve(here, "fixtures/multi/analytics/models"))).toEqual([]);
  });

  it("returns a single-element list for a tree with exactly one project", () => {
    const single = findDbtProjects(resolve(here, "fixtures/multi/analytics"));
    expect(single).toHaveLength(1);
    expect(single[0]).toBe(resolve(here, "fixtures/multi/analytics"));
  });

  it("finds a deeply nested project without missing it", () => {
    const deep = findDbtProjects(MULTI).find((p) => p.endsWith("sub/warehouse"));
    expect(deep).toBeDefined();
  });
});

describe("extractModels", () => {
  it("extracts only model nodes from a manifest", () => {
    const manifest: DbtManifest = {
      nodes: {
        "model.proj.a": { resource_type: "model", unique_id: "model.proj.a", original_file_path: "models/a.sql" },
        "test.proj.a": { resource_type: "test", unique_id: "test.proj.a", original_file_path: "tests/a.sql" },
        "model.proj.b": { resource_type: "model", unique_id: "model.proj.b", original_file_path: "models/b.sql" },
      },
    };
    const models = extractModels(manifest);
    expect(models).toHaveLength(2);
    expect(models.map((m) => m.uniqueId)).toEqual(["model.proj.a", "model.proj.b"]);
  });

  it("returns an empty list for a manifest with no nodes", () => {
    expect(extractModels({})).toEqual([]);
    expect(extractModels({ nodes: {} })).toEqual([]);
  });

  it("falls back to original_file_path as uniqueId when unique_id is absent", () => {
    const manifest: DbtManifest = {
      nodes: {
        "model.proj.a": { resource_type: "model", original_file_path: "models/a.sql" },
      },
    };
    const [model] = extractModels(manifest);
    expect(model?.uniqueId).toBe("models/a.sql");
  });

  it("skips model nodes with no original_file_path", () => {
    const manifest: DbtManifest = {
      nodes: {
        "model.proj.a": { resource_type: "model", unique_id: "model.proj.a" },
      },
    };
    expect(extractModels(manifest)).toEqual([]);
  });
});
