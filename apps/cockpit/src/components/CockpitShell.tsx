import type { CockpitRoute, CockpitViewModel } from "../model/cockpit-view-model";
import { ChangePlanView } from "./ChangePlanView";
import { DecisionRail } from "./DecisionRail";
import { ImpactView } from "./ImpactView";
import { ReceiptsView } from "./ReceiptsView";

const routes: Array<{ route: CockpitRoute; label: string }> = [
  { route: "impact", label: "Impact" },
  { route: "change-plan", label: "Change plan" },
  { route: "receipts", label: "Receipts" },
];

/**
 * What a reader is about to edit, and how much of it is actually known.
 *
 * These two sit side by side at the same optical weight on purpose. The identity
 * answers "what is this", the coverage answers "how much of this can I trust",
 * and a first frame that showed the first without the second would be inviting a
 * decision on evidence whose limits are one scroll away.
 *
 * The counts come from `receipt.accounting`, which the contract reconciles, so
 * nothing here is computed for display.
 */
function FirstFrame({ model }: { model: CockpitViewModel }) {
  const { accounting } = model.receipt;
  return (
    <section className="first-frame" aria-label="Dataset under review">
      <div className="first-frame__identity">
        <p className="eyebrow">Dataset under review</p>
        <h1 id="route-title">{model.title}</h1>
        <p className="subject-urn mono">{model.datasetIdentity.text}</p>
        <p className="frame-summary">{model.summary}</p>
        {/*
          The strip changes when the route or the model changes, and neither
          reloads the page. Without a live region a screen-reader user is told
          the route changed and not that the evidence state under it did, which
          is the half that says whether anything on screen can be trusted.

          Source and resolution are separate chips because they are separate
          axes: a DataHub-sourced claim can read unresolved, and a
          workspace.json-sourced one can read declared.
        */}
        <div className="state-strip" aria-label="Evidence state" aria-live="polite">
          <span className={`chip chip--source-${model.source.toLowerCase().replace(/[^a-z]/g, "")}`}>{model.source}</span>
          <span className="chip chip--resolution">read: {model.read}</span>
          <span className="chip chip--resolution">{model.completeness}</span>
          <span className="chip chip--resolution">{model.resolutionDisposition}</span>
        </div>
      </div>

      <aside className="coverage-panel" aria-label="Coverage of this review">
        <p className="eyebrow">Coverage of this review</p>
        <strong>{model.completeness === "complete-against-pinned-manifest"
          ? "Complete against pinned manifest"
          : "Completeness not established"}</strong>
        <dl>
          <dt>{accounting.datasetsResolved}/{accounting.datasetsRequested}</dt>
          <dd>producer paths resolved</dd>
          <dt>{accounting.datasetsUnresolved}</dt>
          <dd>unresolved</dd>
          <dt>{model.receipt.statedGaps.length}</dt>
          <dd>stated gaps, named in the rail</dd>
        </dl>
      </aside>
    </section>
  );
}

export function CockpitShell({ model, route, onRouteChange }: {
  model: CockpitViewModel;
  route: CockpitRoute;
  onRouteChange(route: CockpitRoute): void;
}) {
  return <main className="cockpit-shell">
    {model.sourceMode === "placeholder" && <p className="placeholder-banner" role="status">DESIGN PLACEHOLDER · NOT OBSERVED DATA</p>}
    <header className="product-header">
      <p className="wordmark">workspace<b>.json</b></p>
      <p className="eyebrow">Change impact cockpit</p>
    </header>

    <FirstFrame model={model} />

    <nav className="view-tabs" aria-label="Cockpit views">{routes.map(({ route: itemRoute, label }) =>
      <button key={itemRoute} className={route === itemRoute ? "active" : ""} aria-current={route === itemRoute ? "page" : undefined} onClick={() => onRouteChange(itemRoute)}>{label}</button>)}</nav>

    <section className="route-slot" aria-labelledby="route-title">
      <div className="route-body">
        <div>
          {route === "impact" ? <ImpactView model={model} />
            : route === "change-plan" ? <ChangePlanView model={model} />
            : <ReceiptsView model={model} />}
        </div>
        <DecisionRail model={model} route={route} onRouteChange={onRouteChange} />
      </div>
    </section>
  </main>;
}
