import { useState } from "react";
import { CockpitShell } from "./components/CockpitShell";
import { selectCockpitAdapter } from "./data/select-adapter";
import type { CockpitRoute } from "./model/cockpit-view-model";

export function App() {
  const model = selectCockpitAdapter().read();
  const [route, setRoute] = useState<CockpitRoute>(model.route);
  return <CockpitShell model={model} route={route} onRouteChange={setRoute} />;
}
