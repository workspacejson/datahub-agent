import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { CockpitShell } from "./components/CockpitShell";
import { DATASET_OPTIONS, DEFAULT_DATASET_KEY, offeredDatasetKey, selectCockpitAdapterByKey, selectCockpitStateAdapter } from "./data/select-adapter";
import { cockpitRouteSchema, cockpitStateNameSchema, type CockpitRoute } from "./model/cockpit-view-model";

function readLocation() {
  const query = new URLSearchParams(window.location.search);
  const path = window.location.pathname.replace(/^\//, "");
  return {
    route: cockpitRouteSchema.catch("impact").parse(path || "impact"),
    state: cockpitStateNameSchema.catch("loading").parse(query.get("state")),
    // Validated, like `route` and `state` above it. This was the one field read
    // raw, and it is the one that chooses which dataset a judge is shown.
    dataset: offeredDatasetKey(query.get("dataset")),
  };
}

function writeLocation(route: CockpitRoute, datasetKey?: string) {
  const url = new URL(window.location.href);
  url.pathname = `/${route === "impact" ? "" : route}`;
  url.searchParams.delete("view");
  // The default is not written into the URL. Writing it would restate the app's
  // own default in every link, and leaving a rejected key in place would let a
  // stale link keep asserting a subject the app already declined to render.
  if (datasetKey && datasetKey !== DEFAULT_DATASET_KEY) url.searchParams.set("dataset", datasetKey);
  else url.searchParams.delete("dataset");
  window.history.pushState(null, "", url);
}

export function App() {
  const [location, setLocation] = useState(() => readLocation());
  const [datasetKey, setDatasetKey] = useState(
    () => location.dataset ?? DEFAULT_DATASET_KEY,
  );
  const model = useMemo(
    () => (import.meta.env.DEV ? selectCockpitStateAdapter(location.state) : selectCockpitAdapterByKey(datasetKey)).read(),
    [location.state, datasetKey],
  );

  useEffect(() => {
    const onPopState = () => {
      const next = readLocation();
      setLocation(next);
      setDatasetKey(next.dataset ?? DEFAULT_DATASET_KEY);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  /*
   * The tab leads with the dataset, not the product. A reviewer with six tabs
   * open is comparing datasets, so `tally · game_events` is the order that tells
   * them which tab is which. Taken from the bound model rather than written into
   * `index.html`, because a placeholder build must not put a real dataset name in
   * a tab; there it stays the product title from the document.
   */
  useEffect(() => {
    if (model.sourceMode === "placeholder") return;
    document.title = `tally · ${model.title}`;
  }, [model.sourceMode, model.title]);

  /**
   * Route changes cross-fade instead of cutting.
   *
   * `document.startViewTransition` rather than an animation library: the three
   * views share a header, a stepper and a rail, and the only thing that should
   * appear to move is the panel that actually changed. Doing that by hand means
   * animating unmount, which is what pulls in a library; the browser already
   * does it from a DOM diff.
   *
   * Feature-detected, and the fallback is the plain state update, so an
   * unsupporting browser gets the same navigation without the transition rather
   * than a broken one. Reduced motion is honoured in CSS, on the
   * `::view-transition-*` pseudo-elements, so the DOM still swaps at full speed
   * for a reader who asked for no animation.
   */
  const goTo = (route: CockpitRoute) => {
    const commit = () => {
      writeLocation(route, datasetKey);
      setLocation((current) => ({ ...current, route }));
    };
    if (typeof document.startViewTransition !== "function") return commit();
    document.startViewTransition(() => flushSync(commit));
  };

  const handleDatasetChange = (key: string) => {
    writeLocation(location.route, key);
    setDatasetKey(key);
  };

  return <CockpitShell model={model} route={location.route} onRouteChange={goTo} datasetKey={datasetKey} datasetOptions={import.meta.env.DEV ? undefined : DATASET_OPTIONS} onDatasetChange={handleDatasetChange} />;
}
