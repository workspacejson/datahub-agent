import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { findDbtProjects } from "../../../src/adapters/workspacejson/index.js";

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
});
