/**
 * Every committed event, held to the contract as it stands today.
 *
 * A fixture is checked against the contract that existed when it was captured.
 * The contract then moves — HAC-267 added an invariant on 2026-07-29, and
 * HAC-242 put `validateEvent` on the cockpit's read path the same day — and
 * nothing re-checks the artifacts already in the tree. A guard that has never
 * been run against the old artifacts has proven nothing about them.
 *
 * That is not hypothetical here. `test/docs/readme-claims.test.ts` loads
 * `change-impact-event.root.json` with `JSON.parse` and a cast to its own local
 * type: no schema parse, no invariants. The fixture a judge's README figures are
 * traced to was captured 2026-07-28T03:08, before several tightenings, and no
 * test held it to any of them.
 *
 * So this sweeps rather than lists. A hardcoded set of paths is a set that drifts
 * the moment someone adds a fixture, and the fixture most likely to be missed is
 * the newest one — which is also the one nobody has checked yet.
 *
 * Discrimination is by shape, not by directory: anything carrying `eventVersion`
 * is an event, and anything carrying `event.eventVersion` is a bundle wrapping
 * one. Sidecars, manifests, workspace artifacts and catalog baselines are
 * skipped because they are not events, not because they are on a list.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { emittedEventSchema, validateEvent } from "../../src/integration/change-impact-event.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Where committed events live. Both are swept whole. */
const ROOTS = ["test/fixtures", "evaluation"];

const SKIP = new Set(["node_modules", ".git"]);

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (SKIP.has(entry)) return [];
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

type Candidate = { path: string; event: unknown };

const candidates: Candidate[] = ROOTS.flatMap((r) => walk(join(root, r)))
  .filter((file) => file.endsWith(".json"))
  .flatMap((file) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return [];
    }
    if (parsed === null || typeof parsed !== "object") return [];
    const record = parsed as Record<string, unknown>;
    // An event, or a bundle carrying one. Nothing else is in scope.
    if ("eventVersion" in record) return [{ path: relative(root, file), event: record }];
    const inner = record.event;
    if (inner !== null && typeof inner === "object" && "eventVersion" in (inner as Record<string, unknown>)) {
      return [{ path: relative(root, file), event: inner }];
    }
    return [];
  })
  .sort((a, b) => a.path.localeCompare(b.path));

describe("every committed event satisfies the contract as it stands now", () => {
  it("finds events to check, so a reorganisation cannot empty this suite", () => {
    // Without this, moving the fixtures turns every assertion below into a
    // vacuous pass over an empty list — a check that cannot fail, which this
    // repository has now found four separate instances of.
    expect(candidates.length).toBeGreaterThanOrEqual(6);
  });

  it("covers the root golden fixture, which its own consumer does not contract-check", () => {
    // Named explicitly because it is the one with a real gap behind it:
    // `readme-claims.test.ts` traces judge-facing README figures to this file
    // through a `JSON.parse` and a cast. If the sweep ever stops reaching it,
    // that fixture goes back to being unchecked by anything.
    expect(candidates.map((c) => c.path)).toContain("test/fixtures/golden/change-impact-event.root.json");
  });

  it("covers the hac-267 unresolved-records fixture by name", () => {
    // Named explicitly because the hac-267 fixture is the only committed event
    // that populates accounting.unresolvedRecords. If it is moved or deleted,
    // the count drops from 8 to 7 — still >= 6, so the guard above would pass
    // silently. This containment check makes the deletion visible.
    expect(candidates.map((c) => c.path)).toContain(
      "evaluation/hac-267/unresolved-repository-mismatch.json",
    );
  });

  describe.each(candidates)("$path", ({ event }) => {
    it("is shaped as the emitter produces one", () => {
      const parsed = emittedEventSchema.safeParse(event);
      const problems = parsed.success
        ? []
        : parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
      expect(problems).toEqual([]);
    });

    it("makes no claim the contract's invariants refuse", () => {
      // The half a schema cannot see. An event can be perfectly shaped and still
      // say something it has no evidence for — a completeness claim with no
      // manifest behind it, or an unresolved list shorter than the count it sits
      // beside.
      expect(validateEvent(event)).toEqual([]);
    });
  });
});
