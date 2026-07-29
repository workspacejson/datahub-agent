import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
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
  it("rejects arbitrary placeholder tokens outside the single provisional module", () => {
    const offenders = files(sourceRoot).filter((file) => (file.endsWith(".ts") || file.endsWith(".tsx")) && !file.includes(".test."))
      .filter((file) => !file.endsWith("data/provisional-source.ts"))
      .filter((file) => /["'`]<(?:[^>\n])+>["'`]/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
