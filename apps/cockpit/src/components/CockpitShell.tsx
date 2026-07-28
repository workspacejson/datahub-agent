import type { CockpitRoute, CockpitViewModel } from "../model/cockpit-view-model";
import { ChangePlanView } from "./ChangePlanView";
import { ImpactView } from "./ImpactView";
import { ReceiptsView } from "./ReceiptsView";

const routes: Array<{ route: CockpitRoute; label: string }> = [
  { route: "impact", label: "Impact" },
  { route: "change-plan", label: "Change plan" },
  { route: "receipts", label: "Receipts" },
];

export function CockpitShell({ model, route, onRouteChange }: {
  model: CockpitViewModel;
  route: CockpitRoute;
  onRouteChange(route: CockpitRoute): void;
}) {
  return <main className="cockpit-shell">
    {model.sourceMode === "placeholder" && <p className="placeholder-banner" role="status">DESIGN PLACEHOLDER · NOT OBSERVED DATA</p>}
    <header className="product-header">
      <p className="eyebrow">CHANGE IMPACT COCKPIT</p>
      <nav aria-label="Cockpit views">{routes.map(({ route: itemRoute, label }) =>
        <button key={itemRoute} className={route === itemRoute ? "active" : ""} aria-current={route === itemRoute ? "page" : undefined} onClick={() => onRouteChange(itemRoute)}>{label}</button>)}</nav>
    </header>
    <section className="state-strip" aria-label="Evidence state">
      <span>{model.source}</span><span>{model.read}</span><span>{model.completeness}</span><span>{model.resolutionDisposition}</span>
    </section>
    <section className="route-slot" aria-labelledby="route-title">
      <p className="eyebrow">{routes.find((item) => item.route === route)?.label}</p>
      <h1 id="route-title">{route === "impact" ? model.title : "Review changed plan"}</h1><p>{route === "impact" ? model.summary : "Compare evidence-bounded plan changes without treating unavailable evidence as a result."}</p>
      {route === "impact" ? <ImpactView model={model} onReviewPlan={() => onRouteChange("change-plan")} /> : route === "change-plan" ? <ChangePlanView model={model} /> : <ReceiptsView model={model} />}
    </section>
  </main>;
}
