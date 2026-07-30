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

  /**
   * The cockpit fetches nothing at render time, and that has to be checkable.
   *
   * This is the assertion that would have caught the `live` source mode. There
   * were three modes, `fixture` and `live` took the same branch, and both read
   * committed bytes at build time — so a build labelled `live` had never
   * contacted anything and nothing said otherwise. The label was legible and its
   * scope was not.
   *
   * Renaming the modes fixes today's artifact. This fixes the class, because it
   * holds whatever the modes end up being called: if no module the browser loads
   * can reach the network, then no build can honestly claim it did, and a future
   * mode named `live` would have to make this test fail first.
   *
   * It also protects a decision already taken and easy to undo by accident. The
   * design system's `fonts.css` is two `@import url(...)` rules against
   * fonts.googleapis.com; `src/styles/tokens/fonts.css` deliberately drops them
   * and says why. Restoring them would give back the offline guarantee for a
   * typeface, silently, so stylesheets are scanned too.
   */
  describe("no runtime network", () => {
    const NETWORK_APIS: ReadonlyArray<[RegExp, string]> = [
      [/\bfetch\s*\(/, "fetch()"],
      [/\bnew\s+XMLHttpRequest\b/, "XMLHttpRequest"],
      [/\bnew\s+WebSocket\b/, "WebSocket"],
      [/\bnew\s+EventSource\b/, "EventSource"],
      [/\bnavigator\s*\.\s*sendBeacon\b/, "navigator.sendBeacon"],
      // `import()` is deliberately absent, for two reasons found by including it
      // first and reading what it caught.
      //
      // It matched `Record<import("../model/...").CockpitStateName, ...>` in
      // `provisional-source.ts`, which is TypeScript's import-type operator in a
      // type position and is erased before anything runs.
      //
      // And even a real dynamic import is the wrong target here: it fetches a
      // same-origin bundle chunk, which is code splitting, not a data dependency
      // on a service. The property this guards is that the cockpit asks nothing
      // outside itself for its evidence. "Nothing leaves the origin at all" is a
      // runtime claim, and the committed-build Playwright case asserts it there.
    ];
    const HTTP_CLIENTS = ["axios", "node-fetch", "ky", "superagent", "got"];

    /** Reports the network APIs a source text reaches for. Extracted so it can be tested. */
    const networkUsesIn = (source: string): string[] => {
      const stripped = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      return NETWORK_APIS.filter(([pattern]) => pattern.test(stripped)).map(([, name]) => name);
    };

    it("keeps every module the browser loads free of network calls", () => {
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
        for (const use of networkUsesIn(source)) offenders.push(`${file.replace(sourceRoot, "")} reaches ${use}`);
        for (const [, clause, spec] of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)\bfrom\s+["']([^"']+)["']/g)) {
          if (/^type\b/.test(clause.trim())) continue;
          if (HTTP_CLIENTS.includes(spec)) offenders.push(`${file.replace(sourceRoot, "")} imports the HTTP client ${spec}`);
          const next = resolve(file, spec);
          if (next && !next.includes(".test.")) queue.push(next);
        }
      }

      expect(seen.size).toBeGreaterThan(5); // the walk actually walked
      expect(offenders).toEqual([]);
    });

    it("keeps stylesheets free of remote font and asset loads", () => {
      const offenders = files(sourceRoot)
        .filter((file) => file.endsWith(".css"))
        .filter((file) => /@import\s+url\(\s*["']?https?:\/\//.test(readFileSync(file, "utf8"))
          || /\burl\(\s*["']?https?:\/\//.test(readFileSync(file, "utf8")))
        .map((file) => file.replace(sourceRoot, ""));
      expect(offenders).toEqual([]);
    });

    /**
     * The detector, watched failing. A scan that silently stopped matching would
     * otherwise pass forever, which is the failure mode this whole file exists
     * to prevent.
     */
    it("still reports a network call, and is not fooled by one inside a comment", () => {
      expect(networkUsesIn('const r = await fetch("/x");')).toEqual(["fetch()"]);
      expect(networkUsesIn("const ws = new WebSocket(url);")).toEqual(["WebSocket"]);
      expect(networkUsesIn("navigator.sendBeacon(url, body);")).toEqual(["navigator.sendBeacon"]);
      // Prose about fetching must not trip it, or the guard becomes unusable in a
      // codebase that explains itself in comments as heavily as this one does.
      expect(networkUsesIn("// we deliberately never call fetch( here")).toEqual([]);
      expect(networkUsesIn("/*\n * No fetch( at render time.\n */")).toEqual([]);
      expect(networkUsesIn("const x = 1;")).toEqual([]);
      // TypeScript's import-type operator is a type position and is erased. This
      // shape is real, from `provisional-source.ts`, and reporting it sent the
      // guard after a module that performs no I/O at all.
      expect(networkUsesIn('type X = Record<import("../model/cockpit-view-model").CockpitStateName, string>;')).toEqual([]);
    });
  });

  it("rejects arbitrary placeholder tokens outside the single provisional module", () => {
    const offenders = files(sourceRoot).filter((file) => (file.endsWith(".ts") || file.endsWith(".tsx")) && !file.includes(".test."))
      .filter((file) => !file.endsWith("data/provisional-source.ts"))
      .filter((file) => /["'`]<(?:[^>\n])+>["'`]/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
