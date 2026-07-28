import { useEffect, useState } from "react";
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

  return <CockpitShell model={model} route={location.route} onRouteChange={(route) => {
    writeLocation(route);
    setLocation((current) => ({ ...current, route }));
  }} />;
}
