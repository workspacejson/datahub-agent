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
  it("rejects invented fixture tokens outside their isolated module", () => {
    const offenders = files(sourceRoot).filter((file) => (file.endsWith(".ts") || file.endsWith(".tsx")) && !file.includes(".test."))
      .filter((file) => !file.endsWith("data/provisional-source.ts"))
      .filter((file) => readFileSync(file, "utf8").includes("<catalogued asset>"));
    expect(offenders).toEqual([]);
  });
});
