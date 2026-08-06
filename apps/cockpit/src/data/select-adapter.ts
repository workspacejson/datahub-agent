import {
  createAdapter,
  provisionalAdapter,
  provisionalStateAdapter,
  type CockpitSourceAdapter,
  type CockpitStateName,
} from "./cockpit-adapter";
import type { SourceEvent, SourceMode } from "../model/cockpit-view-model";
// Eager glob import: Vite resolves these at build time. In placeholder mode
// (which tests run in) the fixtures are never read.
const fixtures = import.meta.glob<{ default: unknown }>(
  "../../../../test/fixtures/golden/change-impact-event.*.json",
  { eager: true },
);

export interface DatasetOption {
  key: string;
  label: string;
}

declare const __COCKPIT_SOURCE_MODE__: SourceMode;
/** The build-time event, or null in a placeholder build. See `vite.config.ts`. */
declare const __COCKPIT_EVENT__: unknown;
/**
 * The build-time comparison, already validated against the event above, or null
 * when no bundle was bound. See `vite.config.ts`.
 */
declare const __COCKPIT_COMPARISON__: SourceEvent["planComparison"] | null;
/**
 * The build-time comparison for the Jaffle Shop (root) dataset, validated
 * against the root fixture event, or null in a placeholder build.
 */
declare const __COCKPIT_ROOT_COMPARISON__: SourceEvent["planComparison"] | null;
/**
 * Build-time syntax-highlighted HTML for the raw evidence receipt, or null in a
 * placeholder build or when Shiki is unavailable. See `vite.config.ts`.
 */
declare const __COCKPIT_RECEIPT_HTML__: string | null;

/**
 * The datasets a judge can switch between in the cockpit.
 *
 * Jaffle Shop (`root`) was removed on 2026-08-02. It remains a supported key
 * below, and remains the corpus `scripts/clean-quickstart-proof.sh` rebuilds,
 * because it is this project's clean-install regression proof. It is not a
 * second product demonstration.
 *
 * Its `code.projectPrefix` is `""`: the dbt path and the repository path are the
 * same string, so there is no prefix to normalize and the silent zero cannot
 * occur. Verified live against a nuked-and-rebuilt DataHub — the root event
 * resolves exactly and correctly renders no failure, while the nested event
 * carries prefix `dbt` and reproduces the naive-join miss.
 *
 * A judge switching to it therefore watched the headline failure disappear
 * beneath a headline still promising proof. Offering it was a trapdoor rather
 * than breadth: a second option that cannot demonstrate the product reads as
 * evidence that the product does not always work. Any second entry here must be
 * another nested-project subject.
 *
 * With one entry `DatasetSelector` renders nothing, which is the intent — the
 * chrome goes with the choice.
 */
export const DATASET_OPTIONS: DatasetOption[] = [
  { key: "nested", label: "game_events (Transfermarkt)" },
];

/** The subject a judge lands on when the URL does not name a valid one. */
export const DEFAULT_DATASET_KEY = "nested";

/**
 * The dataset key a URL is allowed to select, or the default.
 *
 * Removing Jaffle Shop from `DATASET_OPTIONS` on 2026-08-02 removed the chrome
 * and not the route. `readLocation` read `?dataset=` raw while its two siblings,
 * `route` and `state`, were both parsed through a schema with a fallback, so the
 * one field with no validation was the one that chose the subject.
 *
 * Two states were reachable on the deployed build and on neither dev server:
 *
 *   ?dataset=root        rendered `customers`, whose `projectPrefix` is `""`, so
 *                        the coordinate seam renders nothing and the headline
 *                        above it still promised proof of a silent join failure.
 *   ?dataset=<anything>  threw out of `fixtureForKey` with nothing catching it,
 *                        and the judge got a blank page.
 *
 * Both arrive without interaction, from a bookmark or a link predating the
 * removal, and `writeLocation` rewrote the parameter on every navigation so the
 * bad key outlived the tab it came in on.
 *
 * `root` stays a valid argument to `selectCockpitAdapterByKey` because it is the
 * corpus `scripts/clean-quickstart-proof.sh` rebuilds and the fixture tests read.
 * What it stops being is *selectable from a URL*: a link is an offer, and this is
 * the one subject that cannot demonstrate the product.
 */
export function offeredDatasetKey(candidate: string | null | undefined): string {
  return DATASET_OPTIONS.some((option) => option.key === candidate)
    ? (candidate as string)
    : DEFAULT_DATASET_KEY;
}

/** The fixture for a given dataset key. */
function fixtureForKey(key: string): unknown {
  const path = key === "root"
    ? "../../../../test/fixtures/golden/change-impact-event.root.json"
    : key === "nested"
      ? "../../../../test/fixtures/golden/change-impact-event.nested.json"
      : null;
  if (path === null) {
    throw new Error(
      `Unknown dataset key "${key}". Known keys: ${DATASET_OPTIONS.map((o) => o.key).join(", ")}.`,
    );
  }
  return fixtures[path]?.default;
}

/** The adapter for a given dataset key, or the default build-time event. */
export function selectCockpitAdapterByKey(
  key: string = "nested",
  mode: SourceMode = __COCKPIT_SOURCE_MODE__,
): CockpitSourceAdapter {
  if (mode === "placeholder") return provisionalAdapter;

  const event = key === "nested" ? __COCKPIT_EVENT__ : fixtureForKey(key);
  const comparison = key === "nested"
    ? __COCKPIT_COMPARISON__
    : key === "root" ? __COCKPIT_ROOT_COMPARISON__ : null;

  if (event === null || event === undefined) {
    if (key === "nested") {
      throw new Error(
        `A ${mode} build renders a committed event and none was bound. ` +
        "Set COCKPIT_EVENT to a change-impact event, or build with COCKPIT_SOURCE_MODE=placeholder. " +
        "No fallback evidence is invented.",
      );
    }
    throw new Error(
      `Fixture for dataset key "${key}" was not found. ` +
      `Known keys: ${DATASET_OPTIONS.map((o) => o.key).join(", ")}.`,
    );
  }

  return createAdapter(event, mode, comparison);
}

/**
 * Which adapter a build renders through.
 *
 * Until 2026-07-29 this threw for every mode except `placeholder` — "a fixture
 * or live build requires a bound source adapter" — which made placeholder the
 * *only* runnable mode. That reads as a guard and was in fact the missing swap:
 * `createAdapter` already existed in `cockpit-adapter`,
 * and nothing supplied them an event.
 *
 * Both halves are here on purpose, because only one of them is obvious.
 *
 * 1. **Committed mode works.** The event arrives as a build-time constant
 *    so a judge needs no GMS, no network and no file server, and a build that
 *    cannot find its event fails where the message is readable.
 *
 * 2. **Placeholder cannot reach a judge.** That belongs to HAC-226's acceptance
 *    rather than the swap's, and landing the first half without it would leave
 *    invented values reachable on the route a judge takes — the same inversion,
 *    pointed the other way.
 *
 * The second half is enforced in three places, and they fail at different times
 * on purpose:
 *
 *   build     `vite.config.ts` refuses `COCKPIT_SOURCE_MODE=placeholder` for a
 *             production build. Earliest and cheapest.
 *   selection here — a non-placeholder mode never returns the provisional
 *             adapter, and cannot silently fall back to it.
 *   model     `cockpitViewModelSchema` refuses a non-placeholder model carrying
 *             placeholder values, whichever adapter produced it. Last line, and
 *             the one that holds even if a future adapter invents values without
 *             going through the single provisional module. (Named indirectly:
 *             `architecture-invariants` counts any file mentioning that module
 *             by name as an importer of it, and a comment is not an import.)
 *
 * Parameters default to the build-time constants rather than reading them
 * directly, so both modes are reachable from a test. A module whose behaviour is
 * decided by a `define` is a module with one testable branch, and this one has
 * three.
 */
export function selectCockpitAdapter(
  mode: SourceMode = __COCKPIT_SOURCE_MODE__,
  event: unknown = __COCKPIT_EVENT__,
  planComparison: SourceEvent["planComparison"] | null = __COCKPIT_COMPARISON__,
): CockpitSourceAdapter {
  if (mode === "placeholder") return provisionalAdapter;

  if (event === null || event === undefined) {
    throw new Error(
      `A ${mode} build renders a committed event and none was bound. ` +
      "Set COCKPIT_EVENT to a change-impact event, or build with COCKPIT_SOURCE_MODE=placeholder. " +
      "No fallback evidence is invented.",
    );
  }

  // Throws, with the offending contract paths, if the event does not satisfy the
  // schema *and* the invariants. A cockpit that rendered an unvalidated event
  // would be showing a judge claims nothing stands behind.
  return createAdapter(event, mode, planComparison);
}

/**
 * The shell-only state harness, for exercising each rendered state in dev.
 *
 * It is not a way around the rule above: outside placeholder mode it delegates
 * to `selectCockpitAdapter` and gets the real event, so a committed build
 * cannot reach the invented states by asking for one by name.
 */
export function selectCockpitStateAdapter(state: CockpitStateName): CockpitSourceAdapter {
  return __COCKPIT_SOURCE_MODE__ === "placeholder"
    ? provisionalStateAdapter(state)
    : selectCockpitAdapter();
}
