import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The asset capture script may only query selectors the cockpit actually renders.
 *
 * This rule exists because it happened. The reduction pass deleted the six-cell
 * `.outcome-bar` and moved the named residuals out of `.rail-group ul`, and
 * `scripts/capture-readme-assets.mjs` kept targeting both: a `waitForSelector`
 * that could only time out, a `getBoundingClientRect()` on `null`, and a
 * closing-frame guard reading coverage text off an element that no longer
 * existed, so it would have failed with `missing: coverageVisible` and blamed
 * the frame rather than the selector.
 *
 * Nothing caught it. `tsc` does not typecheck a `.mjs` script against a CSS
 * class, biome does not resolve selectors, the cockpit's own suites do not import
 * this script, and the script itself only runs by hand before an asset refresh --
 * which is to say, it fails at exactly the moment someone needs it and has the
 * least context for why.
 *
 * The check is deliberately structural rather than semantic: every class selector
 * the script hands to `waitForSelector` or `querySelector` must appear as a
 * `className` in the cockpit's components or as a rule in its stylesheet. It does
 * not assert the selector matches on the right route, or that the crop is
 * correct. It asserts the weaker thing that would have caught this: the element
 * is something the app can render at all.
 */

const root = new URL("../../", import.meta.url).pathname;
const SCRIPT = join(root, "scripts", "capture-readme-assets.mjs");

/** Where a class may legitimately be defined. */
const SOURCES = [
  join(root, "apps", "cockpit", "src", "styles", "cockpit.css"),
  join(root, "apps", "cockpit", "src", "components"),
];

/**
 * Class names the script asks the page for.
 *
 * Only class selectors, and only the leading class of each compound: `.a .b`
 * contributes both, `.a.b` contributes both, `.hero h1` contributes `hero`. Tag,
 * attribute and pseudo selectors are out of scope because they cannot go stale
 * the way a project-specific class can.
 */
function queriedClasses(script: string): Set<string> {
  const found = new Set<string>();
  const calls = script.matchAll(/(?:waitForSelector|querySelector|querySelectorAll|locator)\(\s*"([^"]+)"/g);
  for (const match of calls) {
    // `noUncheckedIndexedAccess` is on at the root, so the capture group is
    // `string | undefined` even though the pattern cannot match without it.
    const selector = match[1];
    if (selector === undefined) continue;
    for (const name of selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)) {
      if (name[1] !== undefined) found.add(name[1]);
    }
  }
  return found;
}

function cockpitSource(): string {
  const parts: string[] = [];
  for (const entry of SOURCES) {
    if (statSync(entry).isDirectory()) {
      for (const file of readdirSync(entry)) {
        if (file.endsWith(".tsx") || file.endsWith(".ts")) parts.push(readFileSync(join(entry, file), "utf8"));
      }
    } else {
      parts.push(readFileSync(entry, "utf8"));
    }
  }
  return parts.join("\n");
}

describe("the asset capture script targets elements the cockpit renders", () => {
  const script = readFileSync(SCRIPT, "utf8");
  const source = cockpitSource();
  const queried = [...queriedClasses(script)];

  it("finds selectors to check, so the scan cannot pass vacuously", () => {
    // The detector's own guard. A regex that stopped matching would make every
    // assertion below trivially true, which is the failure mode this whole file
    // exists to prevent one level up.
    expect(queried.length).toBeGreaterThan(4);
    expect(queried).toContain("hero");
  });

  it("queries no class the cockpit does not define", () => {
    const orphans = queried.filter((name) => !source.includes(name));
    expect(
      orphans,
      "capture-readme-assets.mjs queries these classes and nothing in apps/cockpit defines them",
    ).toEqual([]);
  });

  it("would catch a class that stopped existing", () => {
    // Against a constructed violation, in the idiom of the other policy guards.
    const fake = queriedClasses('await page.waitForSelector(".a-class-the-cockpit-never-had");');
    expect([...fake].filter((name) => !source.includes(name))).toEqual(["a-class-the-cockpit-never-had"]);
  });
});
