import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { codeToHtml } from "shiki";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { toComparisonState } from "../../src/integration/plan-comparison";
import { NO_COMPARISON_SUPPLIED, projectComparison } from "./src/model/project-comparison";

/**
 * Two modes, because there are two things this build can do.
 *
 * There used to be three: `placeholder`, `fixture` and `live`. `fixture` and
 * `live` took the same branch, read the same committed bytes, and produced the
 * same view model; the only difference was the string baked into
 * `__COCKPIT_SOURCE_MODE__`. So `npm run build` shipped an artifact labelled
 * `live` that had never contacted anything, and the adapter parity test asserting
 * "fixture and live differ only in sourceMode" held by construction rather than
 * by evidence.
 *
 * `live` was a name for a thing that does not exist here. The evidence is always
 * read at build time from a committed file, so the honest label describes how the
 * build acquired it: `committed`.
 *
 * Deliberately not `fixture`. The default bundle is HAC-152's paired Qwen run
 * against a real GMS, so calling it a fixture understates its provenance, which
 * is the same error as `live` pointed the other way. How the evidence was
 * *produced* is a per-evidence question, and the event's own `provenance` block
 * already answers it. This label answers only how this build got hold of it.
 */
const SOURCE_MODES = ["placeholder", "committed"] as const;
const sourceMode = process.env.COCKPIT_SOURCE_MODE ?? "committed";

/**
 * An unrecognised mode fails the build, rather than the page.
 *
 * This exists because the rename above can be outlived by a configuration nobody
 * is looking at. A deploy environment or a shell profile still holding
 * `COCKPIT_SOURCE_MODE=live` would take the `!== "placeholder"` branch, bind the
 * event, build cleanly, and define `__COCKPIT_SOURCE_MODE__` as `"live"` — which
 * `sourceModeSchema` no longer admits, so `normalize` would throw on first render
 * and the judge would get a blank page from a green build.
 *
 * That is the worst available failure shape and the whole point of validating
 * here: a stale value is a legible build error naming what to change, not a
 * working pipeline producing a broken artifact.
 */
if (!(SOURCE_MODES as readonly string[]).includes(sourceMode)) {
  throw new Error(
    `COCKPIT_SOURCE_MODE=${sourceMode} is not a mode. Valid modes are ${SOURCE_MODES.join(" and ")}. ` +
    "`fixture` and `live` were collapsed into `committed` on 2026-07-29: they read the same committed " +
    "bytes at build time, so `live` claimed a connection that never happened. If this came from a " +
    "deploy environment variable, remove it: `committed` is the default and needs no configuration.",
  );
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

    // A bundle missing its `event` key used to fall through a `??` to
    // DEFAULT_EVENT, silently. The comparison then failed `validateBundle` and
    // degraded to `unavailable`, so the *comparison* was honest — but the event on
    // screen was a different one than the bundle intended, and nothing said so.
    //
    // "The file I asked for was not there, so I used another one" is exactly the
    // kind of substitution this project refuses to make quietly, so it is stated
    // now. The build still proceeds, because a bundle without an event is a
    // recoverable condition and failing here would take the whole cockpit down
    // over a missing comparison.
    const bundledEvent = (bundle as { event?: unknown }).event;
    if (bundledEvent === undefined || bundledEvent === null) {
      const fallback = readJson(DEFAULT_EVENT);
      console.warn(
        `[cockpit] ${bundlePath} carries no \`event\` key, so the bound event is ` +
        `${fallback.resolved} instead. The comparison in that bundle was derived from a ` +
        "different event and will not validate against this one, so the change-plan view " +
        "will state the comparison as unavailable rather than render a mismatched pair.",
      );
      event = fallback.value;
    } else {
      event = bundledEvent;
    }

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

/**
 * Build-time syntax highlighting for the raw evidence receipt.
 *
 * Shiki runs in Node at build time, producing an HTML string with inline styles
 * that is defined into the browser bundle as a constant. Zero runtime cost: the
 * highlighter, its themes, and its WASM engine never reach the browser.
 *
 * Dual themes (light/dark) are emitted via CSS variables, so the receipt
 * respects the cockpit's color scheme without a re-highlight.
 */
let highlightedReceipt: string | null = null;
if (sourceMode !== "placeholder" && event !== null) {
  const jsonString = JSON.stringify(event, null, 2);
  highlightedReceipt = await codeToHtml(jsonString, {
    lang: "json",
    themes: { light: "vitesse-light", dark: "vitesse-dark" },
  });
}

/**
 * The placeholder guard keys on `command`, not on `NODE_ENV`.
 *
 * It used to read `process.env.NODE_ENV === "production"`. That does fire under a
 * plain `vite build`, because Vite sets `NODE_ENV` before evaluating the config —
 * but it is ambient, so it is also *bypassable*. Measured:
 *
 *   COCKPIT_SOURCE_MODE=placeholder vite build                      exit 1, refused
 *   NODE_ENV=development COCKPIT_SOURCE_MODE=placeholder vite build  exit 0, and it
 *                                                                   emitted a real
 *                                                                   dist/ containing
 *                                                                   placeholder
 *
 * So a developer with `NODE_ENV=development` exported in their shell could ship a
 * placeholder build with no error. `command` is supplied by Vite from the
 * invocation itself and cannot be set from the environment, which is the property
 * a guard on this needs.
 */
export default defineConfig(async ({ command }) => {
  if (command === "build" && sourceMode === "placeholder") {
    throw new Error(
      "A build rejects COCKPIT_SOURCE_MODE=placeholder: a placeholder artifact renders " +
      "invented evidence and must not reach a judge. Use `npm run build` for a committed " +
      "build, or `npm run dev:placeholder` to view the design states locally.",
    );
  }

  return {
    resolve: {
      alias: {
        "@contract": fileURLToPath(new URL("../../src/integration/change-impact-event.ts", import.meta.url)),
        "@comparison": fileURLToPath(new URL("../../src/integration/plan-comparison.ts", import.meta.url)),
      },
    },
    plugins: [react(), tailwindcss()],
    define: {
      __COCKPIT_SOURCE_MODE__: JSON.stringify(sourceMode),
      __COCKPIT_EVENT__: JSON.stringify(event),
      __COCKPIT_COMPARISON__: JSON.stringify(planComparison),
      __COCKPIT_RECEIPT_HTML__: JSON.stringify(highlightedReceipt),
    },
  };
});
