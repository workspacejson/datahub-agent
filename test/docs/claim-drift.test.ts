/**
 * Claim-drift guards for documents that reference commands or files a judge
 * might follow.
 *
 * The README, JUDGING.md, and examples/README.md each name npm scripts and
 * file paths. If a script is renamed or a file moves, the doc goes stale
 * silently — the exact defect class this project is organised against.
 *
 * These tests pin the *existence* of what those documents reference, not their
 * output. They fail CI when a doc points at something that no longer exists.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("JUDGING.md references only existing npm scripts", () => {
  const JUDGING = readFileSync(join(repoRoot, "JUDGING.md"), "utf8");
  const scriptRefs = JUDGING.match(/npm run ([\w:-]+)/g) ?? [];
  const uniqueScripts = [...new Set(scriptRefs.map((s) => s.replace("npm run ", "")))];

  it("finds at least one npm run reference", () => {
    expect(uniqueScripts.length).toBeGreaterThan(0);
  });

  it.each(uniqueScripts)("npm run %s exists in package.json", (script) => {
    expect(packageJson.scripts[script], `JUDGING.md references "npm run ${script}" but it is not in package.json`).toBeDefined();
  });
});

describe("README references only existing npm scripts", () => {
  const README = readFileSync(join(repoRoot, "README.md"), "utf8");
  const scriptRefs = README.match(/npm run ([\w:-]+)/g) ?? [];
  const uniqueScripts = [...new Set(scriptRefs.map((s) => s.replace("npm run ", "")))];

  it.each(uniqueScripts)("npm run %s exists in package.json", (script) => {
    expect(packageJson.scripts[script], `README references "npm run ${script}" but it is not in package.json`).toBeDefined();
  });
});

describe("examples/README.md references only existing files", () => {
  const EXAMPLES = readFileSync(join(repoRoot, "examples/README.md"), "utf8");
  const fileRefs = EXAMPLES.match(/\]\((\.\.\/[^)]+)\)/g) ?? [];
  const paths = fileRefs.map((s) => s.replace("](", "").replace(")", ""));

  it.each(paths)("%s exists on disk", (relPath) => {
    const abs = join(repoRoot, "examples", relPath);
    expect(existsSync(abs), `examples/README.md references ${relPath} but it does not exist`).toBe(true);
  });
});

describe("evaluation/README.md evidence ledger references only existing files", () => {
  const EVAL_README = readFileSync(join(repoRoot, "evaluation/README.md"), "utf8");
  const fileRefs = EVAL_README.match(/\]\(([^)]+)\)/g) ?? [];
  const paths = fileRefs
    .map((s) => s.replace("](", "").replace(")", ""))
    .filter((p) => !p.startsWith("http") && !p.startsWith("#"));

  it("finds at least one file reference", () => {
    expect(paths.length).toBeGreaterThan(0);
  });

  it.each(paths)("%s exists on disk", (relPath) => {
    const abs = join(repoRoot, "evaluation", relPath);
    expect(existsSync(abs), `evaluation/README.md references ${relPath} but it does not exist`).toBe(true);
  });
});

describe("docs/adopter-contract.md references only existing files", () => {
  const ADOPTER = readFileSync(join(repoRoot, "docs/adopter-contract.md"), "utf8");
  const fileRefs = ADOPTER.match(/\]\((\.\.\/[^)]+|[^)]+)\)/g) ?? [];
  const paths = fileRefs
    .map((s) => s.replace("](", "").replace(")", ""))
    .filter((p) => !p.startsWith("http") && !p.startsWith("#"));

  it.each(paths)("%s exists on disk", (relPath) => {
    const abs = join(repoRoot, "docs", relPath);
    expect(existsSync(abs), `docs/adopter-contract.md references ${relPath} but it does not exist`).toBe(true);
  });
});
