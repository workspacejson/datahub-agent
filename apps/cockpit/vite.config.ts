import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { toComparisonState } from "../../src/integration/plan-comparison";
import { NO_COMPARISON_SUPPLIED, projectComparison } from "./src/model/project-comparison";

const sourceMode = process.env.COCKPIT_SOURCE_MODE ?? "placeholder";

if (process.env.NODE_ENV === "production" && sourceMode === "placeholder") {
  throw new Error("Judge and production builds reject COCKPIT_SOURCE_MODE=placeholder.");
}

/**
 * The event a fixture or live build renders, resolved at build time.
 *
 * Until now `selectCockpitAdapter` threw for every non-placeholder mode — "a
 * fixture or live build requires a bound source adapter" — which made placeholder
 * the only runnable mode and left the fixture path unreachable. The adapter
 * factory and the parity check already existed; nothing supplied them an event.
 *
 * Read here rather than fetched at runtime, deliberately. A judge opening the
 * cockpit should not depend on a running GMS, a network, or a file server; the
 * evidence is committed, so it can be part of the bundle. It also means a build
 * that cannot find its event fails at build time, where the message is legible,
 * rather than rendering an empty shell in a browser.
 *
 * The default is the nested Transfermarkt package, because that is the corpus the
 * judge-facing evidence is about — jaffle remains the regression corpus.
 */
const DEFAULT_EVENT = "../../test/fixtures/golden/change-impact-event.nested.json";

/**
 * The judge run a fixture or live build renders: HAC-152's paired external-model
 * comparison, together with the event it is bound to.
 *
 * Bound here as a whole rather than as two independently chosen files, because
 * `PlanComparisonArtifact` carries the digest of the event it was derived from
 * and `validateBundle` refuses the pair if they disagree. Letting `COCKPIT_EVENT`
 * and a comparison be selected separately would offer a combination that can only
 * ever fail, and would fail at render rather than here.
 *
 * Setting `COCKPIT_EVENT` still works and still renders that event; it simply
 * carries no comparison, and the change-plan view states that in a sentence.
 */
const DEFAULT_BUNDLE = "../../evaluation/hac-152/live-qwen-judge-run-bundle.json";
const readJson = (relative: string) => {
  const resolved = fileURLToPath(new URL(relative, import.meta.url));
  try {
    return { resolved, value: JSON.parse(readFileSync(resolved, "utf8")) as unknown };
  } catch (cause) {
    throw new Error(
      `COCKPIT_SOURCE_MODE=${sourceMode} could not read ${resolved}. ` +
      "Set COCKPIT_EVENT to a committed change-impact event, or COCKPIT_BUNDLE to a committed judge-run bundle.",
      { cause },
    );
  }
};

let event: unknown = null;
let planComparison: ReturnType<typeof projectComparison> | { state: "unavailable"; reason: string } | null = null;

if (sourceMode !== "placeholder") {
  const explicitEvent = process.env.COCKPIT_EVENT;
  if (explicitEvent) {
    event = readJson(explicitEvent).value;
  } else {
    const bundlePath = process.env.COCKPIT_BUNDLE ?? DEFAULT_BUNDLE;
    const bundle = readJson(bundlePath).value;
    event = (bundle as { event?: unknown }).event ?? readJson(DEFAULT_EVENT).value;

    // The digest check, the shared-run-identity check and the "every delta cites
    // evidence the event contains" check all live in `validateBundle`, reached
    // through here. It runs in Node, at build time, because it hashes with
    // `node:crypto`; only its *result* is defined into the browser bundle. A
    // comparison that fails validation is not a build failure: it reaches the
    // view as `unavailable` carrying the problems, which is a state a judge can
    // read and act on, and is strictly more honest than a build that succeeds by
    // dropping the offending deltas.
    const state = toComparisonState(bundle, NO_COMPARISON_SUPPLIED);
    planComparison = state.status === "observed"
      ? projectComparison(state.comparison)
      : { state: "unavailable", reason: state.reason };
  }
}

export default defineConfig({
    resolve: {
    alias: { "@contract": fileURLToPath(new URL("../../src/integration/change-impact-event.ts", import.meta.url)), "@comparison": fileURLToPath(new URL("../../src/integration/plan-comparison.ts", import.meta.url)) },
  },
plugins: [react(), tailwindcss()],
  define: {
    __COCKPIT_SOURCE_MODE__: JSON.stringify(sourceMode),
    __COCKPIT_EVENT__: JSON.stringify(event),
    __COCKPIT_COMPARISON__: JSON.stringify(planComparison),
  },
});
