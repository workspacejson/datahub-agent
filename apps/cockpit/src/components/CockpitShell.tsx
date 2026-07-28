import type { CockpitRoute, CockpitViewModel } from "../model/cockpit-view-model";

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
      <h1 id="route-title">{model.title}</h1><p>{model.summary}</p>
      <div className="deferred-surface">Structure owned by the corresponding delivery lane.</div>
      {route === "impact" && <button className="cta" type="button">Review changed plan</button>}
    </section>
  </main>;
}
