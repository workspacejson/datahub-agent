import type { CockpitRoute, CockpitViewModel } from "../model/cockpit-view-model";
import { ChangePlanView } from "./ChangePlanView";
import { DecisionRail } from "./DecisionRail";
import { ImpactView } from "./ImpactView";
import { ReceiptsView } from "./ReceiptsView";
import { SourceTag } from "./SourceTag";

/**
 * The three views are a sequence, not three parallel destinations.
 *
 * Evidence, then the plan that evidence supports, then the receipt for both. The
 * primary action advances it. Rendering them as a plain tab bar gave the reader
 * two affordances for the same move and made the CTA look like a duplicate of a
 * tab 600px above it; numbering them says the order carries meaning, and leaves
 * the CTA as the only thing that moves you forward.
 */
const routes: Array<{ route: CockpitRoute; label: string }> = [
  { route: "impact", label: "Impact" },
  { route: "change-plan", label: "Change plan" },
  { route: "receipts", label: "Receipts" },
];

const READ_LABEL: Record<CockpitViewModel["read"], string> = {
  ok: "returned",
  failed: "failed",
  "not-queried": "not queried",
};

/**
 * What is under review, and how much of it is actually known.
 *
 * This used to state the same three facts in three registers stacked on top of
 * each other: a prose tier line, four bare chips, and this panel. `exact` and
 * `not-established` as free-standing tokens had no visible subject, so a reader
 * could not tell what was exact or what was not established, and the tier line
 * sat directly above "Completeness not established" appearing to contradict it.
 *
 * One statement now, and it is this one: it is labelled, its numbers have
 * subjects, and each axis names what it is an axis of. The tier moved to
 * Receipts, next to the evidence records that produce it, which is the only
 * place its narrow meaning (one record carries an executed check) can be read
 * without being mistaken for a warrant over the whole screen.
 */
function CoveragePanel({ model }: { model: CockpitViewModel }) {
  const { accounting } = model.receipt;
  const complete = model.completeness === "complete-against-pinned-manifest";
  // A live region, inherited from the chip strip this replaced. The panel changes
  // when the route or the model changes and neither reloads the page, so without
  // it a screen-reader user is told the route changed and not that the evidence
  // state under it did, which is the half that says whether anything on screen
  // can be trusted.
  return (
    <aside className="coverage" aria-label="Coverage of this review" aria-live="polite">
      <p className="eyebrow">Coverage of this review</p>
      <p className={`coverage__headline ${complete ? "" : "coverage__headline--open"}`}>
        {complete ? "Complete against pinned manifest" : "Completeness not established"}
      </p>

      <dl className="coverage__counts">
        <div>
          <dt>{accounting.datasetsResolved}<span className="coverage__of">/{accounting.datasetsRequested}</span></dt>
          <dd>producer paths resolved</dd>
        </div>
        <div>
          <dt>{accounting.datasetsUnresolved}</dt>
          <dd>datasets unresolved</dd>
        </div>
        <div>
          <dt>{model.receipt.statedGaps.length}</dt>
          <dd>gaps stated, each named</dd>
        </div>
      </dl>

      {/*
        The axes the chips used to carry, with the subjects the chips lacked.
        Source and resolution stay separate lines because they are separate
        axes: a DataHub-sourced claim can still read unresolved.
      */}
      <dl className="coverage__axes">
        <div><dt>Lineage read</dt><dd>{READ_LABEL[model.read]}</dd></div>
        <div><dt>Path resolution</dt><dd>{model.resolutionDisposition}</dd></div>
        {/*
          `unavailable` is a real value of this axis and is not a claim source,
          so it renders as the word rather than being cast into a tag. A source
          tag that said "unavailable" would attribute the evidence to a system
          called unavailable.
        */}
        <div><dt>Evidence source</dt><dd>
          {model.source === "unavailable" ? "none attributable" : <SourceTag source={model.source} />}
        </dd></div>
      </dl>
    </aside>
  );
}

export function CockpitShell({ model, route, onRouteChange }: {
  model: CockpitViewModel;
  route: CockpitRoute;
  onRouteChange(route: CockpitRoute): void;
}) {
  const step = routes.findIndex((item) => item.route === route);

  return <main className="cockpit-shell">
    {model.sourceMode === "placeholder" && <p className="placeholder-banner" role="status">DESIGN PLACEHOLDER · NOT OBSERVED DATA</p>}

    <header className="product-header">
      <p className="wordmark">workspace<b>.json</b></p>
      <p className="eyebrow">Change impact cockpit</p>
    </header>

    <section className="first-frame" aria-label="Dataset under review">
      <div className="first-frame__identity">
        <p className="eyebrow">Dataset under review</p>
        <h1 id="route-title">{model.title}</h1>
        {/*
          The URN carries its own source tag. It used to be repeated by a
          `Dataset identity` card in the Impact row, which is where the
          attribution lived; removing that duplication would otherwise have taken
          the attribution with it, and an identifier on a judge surface without
          the system that asserted it is exactly the collapse this cockpit
          refuses.
        */}
        <p className="subject-urn">
          <span className="mono">{model.datasetIdentity.text}</span>
          <SourceTag source={model.datasetIdentity.source} />
        </p>
      </div>
      <CoveragePanel model={model} />
    </section>

    <nav className="stepper" aria-label="Review sequence">
      <ol>
        {routes.map(({ route: itemRoute, label }, index) => (
          <li key={itemRoute} className={index === step ? "is-current" : index < step ? "is-done" : ""}>
            <button
              type="button"
              aria-current={route === itemRoute ? "step" : undefined}
              onClick={() => onRouteChange(itemRoute)}
            >
              <span className="stepper__index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <span className="stepper__label">{label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>

    <section className="route-slot" aria-labelledby="route-title">
      <div className="route-body">
        <div className="route-body__main">
          {route === "impact" ? <ImpactView model={model} />
            : route === "change-plan" ? <ChangePlanView model={model} />
            : <ReceiptsView model={model} />}
        </div>
        <DecisionRail model={model} route={route} onRouteChange={onRouteChange} />
      </div>
    </section>
  </main>;
}
