import { provisionalAdapter, provisionalStateAdapter, type CockpitSourceAdapter, type CockpitStateName } from "./cockpit-adapter";

declare const __COCKPIT_SOURCE_MODE__: "placeholder" | "fixture" | "live";

export function selectCockpitAdapter(): CockpitSourceAdapter {
  if (__COCKPIT_SOURCE_MODE__ === "placeholder") return provisionalAdapter;
  throw new Error("A fixture or live build requires a bound source adapter; no fallback evidence is invented.");
}

export function selectCockpitStateAdapter(state: CockpitStateName): CockpitSourceAdapter {
  return __COCKPIT_SOURCE_MODE__ === "placeholder"
    ? provisionalStateAdapter(state)
    : selectCockpitAdapter();
}
