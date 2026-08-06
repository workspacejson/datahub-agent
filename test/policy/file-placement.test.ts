/**
 * Where a file lives decides whether anything checks it.
 *
 * This is not a tidiness rule. `tsconfig.json` covers `src/**` and `test/**`,
 * and biome covers `scripts/**`, `migration/**`, and the cockpit e2e server —
 * so a `.mjs` written anywhere else is checked by nothing at all, silently.
 * That is not a hypothetical: ~3,705 lines of `scripts/*.mjs` sat unchecked
 * until 2026-07-29, and the gap was invisible precisely because nothing was
 * out of place. It was the *directory* that was uncovered, not the files.
 *
 * So the rule ties placement to coverage rather than to convention, and asserts
 * the coverage config agrees. Widening one without the other fails here.
 *
 * The test-home rule records a decision rather than enforcing a preference. This
 * repository deliberately runs two conventions — the root workspace separates
 * tests into `test/`, the cockpit colocates them beside source, which is the
 * norm in each ecosystem — plus Playwright specs under `e2e/`. Three homes, each
 * with a runner that actually collects it. A test outside all three is not
 * "untidy"; it is a test nothing runs.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Directories the biome gate lints. Kept in step with `biome.jsonc` below. */
const LINTED_DIRS = ["scripts", "migration", join("apps", "cockpit", "e2e")];

/**
 * Where a test may live, and what runs it there. A home with no runner is not a
 * home — the point of the list is that every entry is collected by something.
 */
const TEST_HOMES: ReadonlyArray<{ dir: string; runner: string }> = [
  { dir: "test", runner: "root vitest (vitest.config.ts)" },
  { dir: join("apps", "cockpit", "src"), runner: "cockpit vitest (apps/cockpit/vitest.config.ts)" },
  { dir: join("apps", "cockpit", "e2e"), runner: "playwright (apps/cockpit/playwright.config.ts)" },
];

const SKIP = new Set(["node_modules", ".git", "dist", "build", "coverage", "test-results", "playwright-report", ".vite"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP.has(entry)) return [];
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(root).map((f) => relative(root, f));
const under = (file: string, dir: string) => file === dir || file.startsWith(`${dir}${sep}`);

describe("every .mjs sits somewhere the lint gate actually looks", () => {
  const scripts = files.filter((f) => f.endsWith(".mjs"));

  it("finds .mjs files to check, so a reorganisation cannot empty this suite", () => {
    // Without this, moving the scripts turns every assertion below into a
    // vacuous pass over an empty list.
    expect(scripts.length).toBeGreaterThan(0);
  });

  it.each(scripts.map((f) => [f] as const))("%s", (file) => {
    expect(
      LINTED_DIRS.some((dir) => under(file, dir)),
      `${file} is outside every linted directory (${LINTED_DIRS.join(", ")}), so nothing checks it — ` +
      `not tsc, which covers only src/**/*.ts and test/**/*.ts, and not biome. Move it, or widen ` +
      `biome.jsonc's files.includes and LINTED_DIRS together.`,
    ).toBe(true);
  });

  it("keeps the linted directories and biome's own config in step", () => {
    // The rule above is only as true as this list. If biome's scope is widened
    // or narrowed and this is not, the placement rule starts vouching for
    // coverage that does not exist — which is worse than not checking at all.
    const config = readFileSync(join(root, "biome.jsonc"), "utf8");
    for (const dir of LINTED_DIRS) {
      expect(config, `biome.jsonc does not include ${dir}, which LINTED_DIRS claims is linted`)
        .toContain(`${dir}/**/*.mjs`);
    }
  });
});

describe("every test sits somewhere a runner collects it", () => {
  const tests = files.filter((f) => /\.(test|spec)\.[cm]?tsx?$/.test(f));

  it("finds test files to check", () => {
    expect(tests.length).toBeGreaterThan(0);
  });

  it.each(tests.map((f) => [f] as const))("%s", (file) => {
    const home = TEST_HOMES.find((h) => under(file, h.dir));
    expect(
      home,
      `${file} is outside every test home, so no runner collects it and it will pass by never ` +
      `executing. Homes: ${TEST_HOMES.map((h) => `${h.dir} (${h.runner})`).join("; ")}.`,
    ).toBeDefined();
  });

  it("records that two conventions is deliberate, not drift", () => {
    // Root separates, the cockpit colocates. Both are the norm in their own
    // ecosystem, and moving twelve cockpit tests to satisfy a single convention
    // would be churn with no reader served. This assertion exists so that
    // reading the layout does not raise the question a second time.
    expect(TEST_HOMES.some((h) => h.dir === "test")).toBe(true);
    expect(TEST_HOMES.some((h) => h.dir === join("apps", "cockpit", "src"))).toBe(true);
  });
});
