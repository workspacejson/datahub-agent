/**
 * A committed file must not name the machine it was produced on, or the private
 * tooling that produced it.
 *
 * This rule exists because both happened. Four audit reports under `evaluation/`
 * shipped with `> **Worktree:** /Users/<name>/Documents/hackathons/audit-wt-NN`
 * in their headers, which disclosed an operator's home directory and the layout
 * of a private audit fleet; and `package.json` carried seven `demo:*` scripts
 * pointing at `scripts/demo/*.mjs`, a directory that has never existed in this
 * repository's history. The second one is the worse failure: they were public,
 * documented entry points that could not run, in a repository whose whole claim
 * is that an assertion needs observable evidence behind it.
 *
 * Neither was caught by anything. `tsc` does not read Markdown, biome does not
 * read `package.json` script targets, and no test read either. The gap was not
 * that the rule was hard to follow — it was that nothing checked.
 *
 * The list below is deliberately short and literal. It bans *operator identity*
 * (absolute home paths), *delivery topology* (the audit-worktree naming scheme),
 * and *named private tooling* (paths that resolve to nothing public). It does
 * not ban the words "audit", "judge", "demo", or "narration": those describe
 * legitimate public surfaces, and banning them would produce noise that trains
 * a reader to skip this test rather than to fix what it finds.
 *
 * Adding a pattern here is cheap. Adding one that fires on honest documentation
 * is not, so each entry names what it is protecting against.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** This file quotes every banned pattern in order to ban it. */
const SELF = "test/policy/no-private-machinery-references.test.ts";

const FORBIDDEN: ReadonlyArray<{ pattern: string; because: string }> = [
  {
    pattern: "/Users/",
    because: "an absolute macOS home path identifies the operator and the machine, and cannot resolve for anyone else",
  },
  {
    pattern: "/Documents/hackathons/",
    because: "a local working-directory layout is operator identity, not reproducibility metadata",
  },
  {
    pattern: "audit-wt-",
    because: "the audit-worktree naming scheme is delivery topology; the audits themselves are public, the fleet layout is not",
  },
  {
    pattern: "scripts/demo/",
    because: "no such directory has ever been committed; a script target that cannot run is a claim with nothing behind it",
  },
  {
    pattern: "obs-cue-manifest",
    because: "generated output of recording-capture tooling that is not part of this repository",
  },
  {
    pattern: "cockpit-alignment-audit-prompt",
    because: "removed as private review tooling; a dangling reference would reintroduce it as a broken link",
  },
];

/**
 * Exceptions, each with the reason it is not the thing the rule is aimed at.
 * An allowlist entry is a claim that a specific occurrence is honest, so it
 * names the file and the occurrence rather than waving a directory through.
 */
const ALLOWED: ReadonlyArray<{ file: string; pattern: string; because: string }> = [
  {
    file: "test/policy/clean-room.test.ts",
    pattern: "/Users/",
    because:
      "`/Users/someone/cli` is a synthetic poisoned-manifest fixture proving the clean-room audit rejects absolute paths. It names no real operator, and removing it would delete the test's negative case.",
  },
];

/** Files whose bytes are not text; reading them as UTF-8 proves nothing. */
const BINARY = /\.(png|gif|jpg|jpeg|webp|ico|woff2?|ttf|otf|duckdb|pdf|zip|gz)$/i;

function trackedTextFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  return out.split("\0").filter((f) => f.length > 0 && !BINARY.test(f));
}

const files = trackedTextFiles();

describe("no committed file names an operator, a machine, or private tooling", () => {
  it("finds tracked text files to check, so a reorganisation cannot empty this suite", () => {
    // Without this, a change that breaks `git ls-files` turns every assertion
    // below into a vacuous pass over an empty list — the failure mode this
    // repository has already hit once, in a mutation sweep whose detector was
    // never validated against a known-bad baseline.
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(FORBIDDEN.map((f) => [f.pattern, f.because] as const))(
    "no tracked file contains %s",
    (pattern, because) => {
      const hits = files.filter((file) => {
        if (file === SELF) return false;
        if (ALLOWED.some((a) => a.file === file && a.pattern === pattern)) return false;
        return readFileSync(join(root, file), "utf8").includes(pattern);
      });

      expect(
        hits,
        `${hits.join(", ")} contains "${pattern}" — ${because}. If the occurrence is honest, ` +
        `add it to ALLOWED with the reason it is not what this rule is aimed at.`,
      ).toEqual([]);
    },
  );

  it("keeps every allowlist entry earning its place", () => {
    // An exception that no longer applies is worse than no exception: it
    // silently widens the rule for a file that has since changed.
    for (const { file, pattern } of ALLOWED) {
      expect(files, `${file} is allowlisted but is no longer tracked`).toContain(file);
      expect(
        readFileSync(join(root, file), "utf8").includes(pattern),
        `${file} is allowlisted for "${pattern}" but no longer contains it — remove the exception`,
      ).toBe(true);
    }
  });
});

describe("every package script points at something that exists", () => {
  // The seven `demo:*` scripts named files under `scripts/demo/` that were
  // never committed. `npm run` reported them as available; running one failed.
  // A manifest entry is a claim about what this repository can do.
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  const targets = Object.entries(manifest.scripts).flatMap(([name, command]) =>
    [...command.matchAll(/(?:^|\s)((?:scripts|migration)\/[\w./-]+\.(?:mjs|sh|ts))/g)].map(
      (m) => [name, m[1]] as const,
    ),
  );

  it("finds script targets to check", () => {
    expect(targets.length).toBeGreaterThan(0);
  });

  it.each(targets.map(([name, target]) => [name, target] as const))(
    "%s -> %s",
    (name, target) => {
      expect(
        files,
        `package.json script "${name}" runs ${target}, which is not a tracked file. ` +
        `Either commit it, or remove the script — a manifest entry that cannot run is a claim with nothing behind it.`,
      ).toContain(target);
    },
  );
});
