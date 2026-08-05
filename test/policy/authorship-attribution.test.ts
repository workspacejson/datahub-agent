/**
 * This project was built by one person. The metadata must not say otherwise.
 *
 * `package.json` declared `"author": "workspace-json contributors"` until this
 * test existed. That is the one field whose entire job is to answer who wrote
 * the package, it is machine-readable, and it was plural — while the commit
 * graph shows a single human across every commit. A judge reading a repository
 * whose thesis is that claims need evidence should not have to reconcile
 * metadata saying one builder with prose saying "we".
 *
 * The rule is deliberately narrow. It does **not** scan for `we` or `our`:
 * those are correct in product voice ("we asked and could not determine"
 * describes what the read path did, not who wrote it), correct inside quoted
 * claims under comparison, and correct as engineering-comment idiom. A guard
 * that fired on every plural pronoun would report about a hundred hits on a
 * clean tree, and the only rational response would be to switch it off. A rule
 * that has to be ignored to work is worse than no rule.
 *
 * So this checks two things a regex can actually decide: an exact author value,
 * and a short list of phrases that cannot be true of a solo project. Anything
 * requiring context is a review question, not a test.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** This file quotes every prohibited phrase in order to prohibit it. */
const SELF = "test/policy/authorship-attribution.test.ts";

const AUTHOR = "Qwynn Marcelle";

/**
 * Phrases that assert a group built this. Each is unambiguous: none has a
 * product-voice reading, and none appears in quoted upstream text. Matching is
 * case-insensitive and substring-based, so no phrase here may be a fragment of
 * a legitimate longer string.
 */
const PROHIBITED: ReadonlyArray<{ phrase: string; because: string }> = [
  { phrase: "our team", because: "asserts a group of people built this" },
  { phrase: "our company", because: "asserts an organization built this" },
  { phrase: "our engineers", because: "asserts staffed engineering" },
  { phrase: "the team built", because: "attributes the build to a group" },
  {
    phrase: "workspace-json contributors",
    because:
      "conflates the upstream standard's contributor pool with this application's authorship; it was the package.json author value this rule replaced",
  },
];

/** Bytes that are not text; reading them as UTF-8 proves nothing. */
const BINARY = /\.(png|gif|jpg|jpeg|webp|ico|woff2?|ttf|otf|duckdb|pdf|zip|gz)$/i;

/**
 * External text this repository may not rewrite: dependency manifests and
 * upstream licenses. A prohibited phrase appearing there is not this project
 * making a claim about itself.
 */
const EXTERNAL = /^(package-lock\.json|LICENSE|assets\/source\/_design-system\/fonts\/OFL-)/;

function trackedTextFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  return out
    .split("\0")
    .filter((f) => f.length > 0 && !BINARY.test(f) && !EXTERNAL.test(f) && f !== SELF);
}

const files = trackedTextFiles();

describe("package metadata names the actual author", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    author?: string;
  };

  it("names one person, not a collective", () => {
    expect(manifest.author).toBe(AUTHOR);
  });

  it("does not describe authorship in the plural", () => {
    // Organizational ownership belongs in `repository` or publisher metadata.
    // The author field answers who wrote it, and the answer is one person.
    expect(manifest.author ?? "").not.toMatch(/contributors|team|authors|,/i);
  });
});

describe("no committed file claims a group built this", () => {
  it("finds tracked text files to check, so a reorganisation cannot empty this suite", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(PROHIBITED.map((p) => [p.phrase, p.because] as const))(
    'no tracked file contains "%s"',
    (phrase, because) => {
      const needle = phrase.toLowerCase();
      const hits = files.filter((file) =>
        readFileSync(join(root, file), "utf8").toLowerCase().includes(needle),
      );

      expect(
        hits,
        `${hits.join(", ")} contains "${phrase}" — ${because}. This project was built by ` +
        `one person; see the authorship line in README.md.`,
      ).toEqual([]);
    },
  );
});
