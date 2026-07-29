import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { CockpitShell } from "./components/CockpitShell";
import { selectCockpitAdapter, selectCockpitStateAdapter } from "./data/select-adapter";
import { cockpitRouteSchema, cockpitStateNameSchema, type CockpitRoute } from "./model/cockpit-view-model";

function readLocation() {
  const query = new URLSearchParams(window.location.search);
  return {
    route: cockpitRouteSchema.catch("impact").parse(query.get("view")),
    state: cockpitStateNameSchema.catch("loading").parse(query.get("state")),
  };
}

function writeLocation(route: CockpitRoute) {
  const url = new URL(window.location.href);
  url.searchParams.set("view", route);
  window.history.pushState(null, "", url);
}

export function App() {
  const initial = readLocation();
  const [location, setLocation] = useState(initial);
  const model = (import.meta.env.DEV ? selectCockpitStateAdapter(location.state) : selectCockpitAdapter()).read();

  useEffect(() => {
    const onPopState = () => setLocation(readLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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
      writeLocation(route);
      setLocation((current) => ({ ...current, route }));
    };
    if (typeof document.startViewTransition !== "function") return commit();
    document.startViewTransition(() => flushSync(commit));
  };

  return <CockpitShell model={model} route={location.route} onRouteChange={goTo} />;
}
