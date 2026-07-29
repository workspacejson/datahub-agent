import { readFileSync, readdirSync } from "node:fs";
import { join, resolve as resolve0 } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve0(process.cwd(), "src");
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]);
}

describe("provisional boundary", () => {
  it("allows exactly one importer of the provisional source", () => {
    const importers = files(sourceRoot).filter((file) => (file.endsWith(".ts") || file.endsWith(".tsx")) && !file.includes(".test."))
      .filter((file) => readFileSync(file, "utf8").includes("provisional-source"));
    expect(importers.map((file) => file.replace(sourceRoot, ""))).toEqual(["/data/cockpit-adapter.ts"]);
  });
  /**
   * The cockpit reaches the contracts in `src/` only through named aliases, so
   * the whole surface it depends on is the alias list in three config files. A
   * relative climb out of `apps/cockpit` would reach any module in the repo
   * while still compiling, which is how an app quietly acquires a dependency on
   * a runtime it is supposed to be separable from.
   */
  it("reaches shared contracts only through aliases, never by climbing out", () => {
    const escapees = files(sourceRoot).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
      .filter((file) => /from\s+["'](?:\.\.\/)*\.\.\/\.\.\/src\//.test(readFileSync(file, "utf8")));
    expect(escapees.map((file) => file.replace(sourceRoot, ""))).toEqual([]);
  });
  /**
   * Nothing the browser loads may import a Node builtin.
   *
   * Vite *externalizes* `node:` specifiers for the browser instead of failing,
   * so this class of mistake builds cleanly, passes every node-environment unit
   * test, and then dies on page load. It reached CI once exactly that way, via
   * `@comparison` -> `plan-comparison.ts` -> `node:crypto`, and only the
   * Playwright run caught it.
   *
   * So the check walks the real import graph from the entry rather than
   * allowlisting known offenders: an allowlist records the modules someone
   * thought of, and the failure mode here is precisely the import nobody thought
   * about.
   */
  it("keeps every module the browser loads free of Node builtins", () => {
    const resolve = (from: string, spec: string): string | null => {
      if (!spec.startsWith(".")) return null;
      const base = resolve0(join(from, "..", spec));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
        try { if (readFileSync(candidate, "utf8")) return candidate; } catch { /* keep looking */ }
      }
      return null;
    };

    const entry = join(sourceRoot, "App.tsx");
    const seen = new Set<string>();
    const offenders: string[] = [];
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      // The clause between `import`/`export` and `from` decides whether this edge
      // survives compilation. `import type { X } from "y"` is erased whole by
      // esbuild, so it puts nothing in the browser bundle and cannot carry a Node
      // builtin into it; a value import of the same specifier does.
      //
      // The distinction is drawn here rather than by ignoring `@comparison`,
      // because the two cases fail differently and only one of them is safe. A
      // mixed import (`import { toComparisonState, type Artifact }`) does not
      // start with `type` and is still reported, which is the conservative side
      // to land on: the erasure has to be visible in the statement to be trusted.
      for (const [, clause, spec] of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)\bfrom\s+["']([^"']+)["']/g)) {
        const erased = /^type\b/.test(clause.trim());
        if (erased) continue;
        if (spec.startsWith("node:")) offenders.push(`${file.replace(sourceRoot, "")} imports ${spec}`);
        // `@comparison` reaches `node:crypto`; it is an alias, so the relative
        // walk cannot follow it and it is named here as the one known bridge.
        if (spec === "@comparison") offenders.push(`${file.replace(sourceRoot, "")} imports @comparison, which reaches node:crypto`);
        const next = resolve(file, spec);
        if (next && !next.includes(".test.")) queue.push(next);
      }
    }

    expect(seen.size).toBeGreaterThan(5); // the walk actually walked
    expect(offenders).toEqual([]);
  });

  /**
   * The check above now ignores type-only edges, so it can be blinded by a bad
   * discriminator rather than by a bad import. This exercises the discriminator
   * itself against both forms: a walk that silently stopped reporting would
   * otherwise pass forever, and the invariant it protects has already reached CI
   * once.
   */
  it("still reports a value import of a Node-reaching module, and only ignores erased ones", () => {
    const classify = (source: string) => {
      const found: string[] = [];
      for (const [, clause, spec] of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)\bfrom\s+["']([^"']+)["']/g)) {
        if (!/^type\b/.test(clause.trim())) found.push(spec);
      }
      return found;
    };

    expect(classify('import type { A } from "@comparison";')).toEqual([]);
    expect(classify('import type {\n  A,\n} from "@comparison";')).toEqual([]);
    expect(classify('import { toComparisonState } from "@comparison";')).toEqual(["@comparison"]);
    // Mixed imports are not erased, and are deliberately still reported.
    expect(classify('import { toComparisonState, type A } from "@comparison";')).toEqual(["@comparison"]);
    expect(classify('import { createHash } from "node:crypto";')).toEqual(["node:crypto"]);
    // `export ... from` re-exports a real runtime edge and must not be skipped.
    expect(classify('export { NO_COMPARISON_SUPPLIED } from "./project-comparison";')).toEqual(["./project-comparison"]);
  });

  it("rejects arbitrary placeholder tokens outside the single provisional module", () => {
    const offenders = files(sourceRoot).filter((file) => (file.endsWith(".ts") || file.endsWith(".tsx")) && !file.includes(".test."))
      .filter((file) => !file.endsWith("data/provisional-source.ts"))
      .filter((file) => /["'`]<(?:[^>\n])+>["'`]/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
