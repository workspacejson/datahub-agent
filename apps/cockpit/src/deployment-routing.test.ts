import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { cockpitRouteSchema } from "./model/cockpit-view-model";

/**
 * The deployment's route list against the app's own.
 *
 * `vercel.json` used to rewrite `/(.*)` to `index.html`, which meant the
 * platform could not tell a route from a typo: every path was a 200 and the app
 * was left to decide what it meant. Narrowing the rewrite to the three real
 * routes is what lets an unmatched path fall through to `404.html` with a real
 * status -- and it moves the route list into a second file, where it can drift.
 *
 * The drift is silent in the worst direction. Adding a route to
 * `cockpitRouteSchema` and forgetting this file ships a route that renders
 * correctly in dev, in every unit test and in `vite preview`, and 404s in
 * production. Nothing in the app can notice, because the app never sees the
 * request. So the two lists are compared directly, here, where a new route fails
 * a check that names the file to change.
 */
// Resolved from the vitest root rather than from `import.meta.url`, which is an
// http URL under the jsdom transform. `architecture-invariants.test.ts` walks
// the tree the same way.
const config = JSON.parse(
  readFileSync(resolve(process.cwd(), "../../vercel.json"), "utf8"),
) as {
  trailingSlash?: boolean;
  rewrites?: Array<{ source: string; destination: string }>;
  headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};

describe("the deployment serves exactly the routes the app defines", () => {
  it("rewrites every cockpit route to the app document", () => {
    const rewritten = (config.rewrites ?? [])
      .filter((rule) => rule.destination === "/index.html")
      .map((rule) => rule.source)
      .sort();
    const expected = cockpitRouteSchema.options.map((route) => `/${route}`).sort();

    expect(
      rewritten,
      "add the new route to `rewrites` in vercel.json, or the deployment will 404 it",
    ).toEqual(expected);
  });

  it("rewrites nothing the app cannot route", () => {
    // The other direction, and the one that reintroduces the original defect: a
    // catch-all here would hand every typo back to `index.html` with a 200 and
    // leave the status wrong again.
    for (const rule of config.rewrites ?? []) {
      expect(rule.source, "a wildcard rewrite makes every unmatched path a 200").not.toMatch(/[(*:]/);
    }
  });

  it("keeps a trailing slash a redirect rather than a refusal", () => {
    // `/receipts/` is not a different page. `trailingSlash: false` makes the
    // platform redirect it to `/receipts`; `readLocation` normalises the same
    // shape for the dev servers, which have no platform in front of them.
    expect(config.trailingSlash).toBe(false);
  });

  it("does not let the refusal document be cached as an answer", () => {
    // One document serves every unmatched path. A cached copy under one path is
    // a copy that can be served for another.
    const cache = (config.headers ?? [])
      .find((rule) => rule.source === "/404.html")
      ?.headers.find((header) => header.key === "Cache-Control")?.value;
    expect(cache).toContain("must-revalidate");
  });

  it("would notice the route list going empty", () => {
    // The detector. Both comparisons above are satisfied by two empty lists, and
    // an empty schema would take the whole product down while passing them.
    expect(cockpitRouteSchema.options.length).toBeGreaterThan(2);
  });
});
