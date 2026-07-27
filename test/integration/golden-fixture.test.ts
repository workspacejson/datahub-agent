/**
 * The golden fixtures are real emitter output against a live DataHub, committed
 * so every judge-facing surface renders the same evidence without needing an
 * instance running. These tests are what stop them decaying into hand-edited
 * demo JSON: any drift from the contract, or any loss of the properties that
 * make them worth showing, fails here.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CHANGE_IMPACT_EVENT_VERSION,
  toDataHubOnly,
  validateEvent,
  type ChangeImpactEvent,
} from "../../src/integration/change-impact-event.js";

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/golden");

const load = (name: string): ChangeImpactEvent =>
  JSON.parse(readFileSync(join(goldenDir, name), "utf8")) as ChangeImpactEvent;

const FIXTURES = {
  root: load("change-impact-event.root.json"),
  nested: load("change-impact-event.nested.json"),
} as const;

describe.each(Object.entries(FIXTURES))("golden fixture: %s", (_name, event) => {
  it("satisfies the frozen contract", () => {
    expect(validateEvent(event)).toEqual([]);
  });

  it("declares the contract version the consumers compile against", () => {
    expect(event.eventVersion).toBe(CHANGE_IMPACT_EVENT_VERSION);
  });

  it("carries provenance a reviewer can re-derive the result from", () => {
    expect(event.provenance.corpus.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(event.provenance.corpus.repository).toMatch(/^https:\/\//);
    expect(event.provenance.datahub.gmsVersion).toBeTruthy();
    expect(event.provenance.workspaceArtifact?.producedBy).toBe("@workspacejson/cli");
  });

  it("resolves the producing file to a repository-root-relative path", () => {
    expect(event.code.method).not.toBe("unresolved");
    expect(event.code.repositoryRelativePath).toBeTruthy();
    expect(event.code.repositoryRelativePath).not.toMatch(/^\/|^\.\/|\\/);
  });

  it("pins the source link to an immutable commit, not a branch", () => {
    expect(event.code.sourceUrl).toContain(`/blob/${event.provenance.corpus.commit}/`);
  });

  it("states every absence rather than leaving an empty collection unexplained", () => {
    for (const [collection, field] of [
      [event.datahub.upstreams, "datahub.upstreams"],
      [event.datahub.downstreams, "datahub.downstreams"],
      [event.partners, "partners"],
    ] as const) {
      if (collection.length === 0) {
        expect(event.unavailable.some((u) => u.field === field)).toBe(true);
      }
    }
  });

  it("reduces to a DataHub-only view that still satisfies the contract", () => {
    expect(validateEvent(toDataHubOnly(event))).toEqual([]);
  });
});

describe("the fixtures cover both project layouts", () => {
  it("the root-level fixture has an empty prefix", () => {
    expect(FIXTURES.root.code.projectPrefix).toBe("");
    expect(FIXTURES.root.code.repositoryRelativePath).toBe(FIXTURES.root.code.dbtFilePath);
  });

  it("the nested fixture has a real prefix, and the paths differ by exactly it", () => {
    // This is the case a root-level-only fixture cannot exercise, and the one
    // where a naive join silently returns nothing.
    const { projectPrefix, dbtFilePath, repositoryRelativePath } = FIXTURES.nested.code;
    expect(projectPrefix).toBe("dbt");
    expect(repositoryRelativePath).toBe(`${projectPrefix}/${dbtFilePath}`);
    expect(repositoryRelativePath).not.toBe(dbtFilePath);
  });

  it("both were resolved from the catalog rather than an out-of-band manifest read", () => {
    // Recorded because it is the load-bearing claim: the prefix was derived
    // from what DataHub itself exposed, not from configuration we supplied.
    expect(FIXTURES.root.code.method).toBe("external-url");
    expect(FIXTURES.nested.code.method).toBe("external-url");
  });
});
