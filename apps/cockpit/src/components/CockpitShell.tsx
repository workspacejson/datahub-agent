import type { CockpitRoute, CockpitViewModel } from "../model/cockpit-view-model";
import { Database } from "lucide-react";
import { MotionConfig } from "motion/react";
import { ChangePlanView } from "./ChangePlanView";
import { ContributionBand } from "./ContributionBand";
import { DecisionBar } from "./DecisionBar";
import { DecisionRail } from "./DecisionRail";
import { Icon } from "./Icon";
import { ImpactView } from "./ImpactView";
import { PlanDelta } from "./PlanDelta";
import { ProofPopover } from "./ProofPopover";
import { ReceiptsView } from "./ReceiptsView";
import { ScopeStrip } from "./ScopeStrip";
import { SourceTag } from "./SourceTag";
import type { DatasetOption } from "../data/select-adapter";
import { revisionLabel } from "./format";

/**
 * The resolved file, beside the subject that resolved to it.
 *
 * This is what the boxed "Result" card became. As a card floating under the hero
 * it announced a result twice: once as its own heading and again as the path
 * inside it, and it sat in the same row as the failure it was the answer to, so
 * the two competed. Beside the dataset name it answers "what am I looking at" in
 * one fixation, which is the only job the top of this screen has.
 *
 * The disposition word is the vocabulary term, printed rather than glossed:
 * `exact`, `ambiguous`, `unavailable`, `mismatch` and `indeterminate` each mean
 * something a reader can look up, and a friendlier synonym would lose that. It is
 * also the one place the standing of the resolution is stated on every route now
 * that the six-cell strip is gone, so `house-copy.test.tsx` asserts it here.
 */
function ResolvedSource({ model }: { model: CockpitViewModel }) {
  const prefix = model.projectPrefix;
  const dbtPath = model.dbtFilePath;
  const revision = revisionLabel(model.receipt.provenance.subjectRevision);

  return (
    <div className="resolved-source" aria-label="Standing of this review">
      <p className="eyebrow">Source under review, {model.resolutionDisposition}</p>
      {/*
        The prefix renders as its own slot when the model carries one, because
        the prefix is the whole contribution: highlighting it makes the segment
        DataHub never exposes visible as a shape rather than as a substring a
        reader has to find. Without one the path prints whole rather than being
        sliced on an assumption.
      */}
      <p className="resolved-source__path mono">
        {prefix && dbtPath && model.producerPath.text === `${prefix}/${dbtPath}`
          ? <><span className="resolved-source__prefix">{prefix}/</span>{dbtPath}</>
          : model.producerPath.text}
      </p>
      <p className="resolved-source__pin">
        {revision ? `pinned revision ${revision}` : "no pinned revision recorded"}
        <SourceTag source={model.producerPath.source} />
      </p>
    </div>
  );
}

function DatasetSelector({ datasetKey, options, onChange }: {
  datasetKey?: string;
  options?: DatasetOption[];
  onChange?(key: string): void;
}) {
  if (!options || options.length < 2) return null;
  return (
    <div className="dataset-selector" aria-label="Dataset under review">
      <label className="dataset-selector__label" htmlFor="dataset-select">Dataset under review</label>
      <select
        id="dataset-select"
        className="dataset-selector__select"
        value={datasetKey}
        onChange={(e) => onChange?.(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.key} value={opt.key}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

/**
 * The three views are a sequence, and only the sequence navigates.
 *
 * Two navigation models used to run at once: numbered steps that read as free
 * lateral movement, and rail buttons that read as a linear wizard, with nothing
 * telling a reviewer whether Receipts was reachable before the plan was read or
 * whether clicking a step abandoned anything. Two of the four rail buttons were
 * pure back-navigation dressed as a decision, at the weight of a secondary CTA.
 *
 * Now: the spine is the navigation, every step is reachable and marks itself
 * visited, going back is a text link in the spine, and the two-button pattern is
 * reserved for the one place there is a real decision to make.
 *
 * Each step also says what it is for.
 *
 * The labels are the accessible names and stay exactly as they were: "Change
  plan" reads as a changelog on its own, which is the complaint the subtitle
 * answers, and renaming the control instead would have moved the four e2e
 * assertions that reach for it without making the rail any clearer. The subtitle
 * is `aria-hidden`, so the name a screen reader and a Playwright locator both get
 * is still the label.
 */
const routes: Array<{ route: CockpitRoute; label: string; subtitle: string }> = [
  { route: "impact", label: "Impact", subtitle: "Subject, contributions, the decision" },
  { route: "change-plan", label: "Change plan", subtitle: "How joined evidence changed the plan" },
  { route: "receipts", label: "Receipts", subtitle: "Checked, written, still unknown" },
];

/**
 * The tally lockup, per the approved nav spec.
 *
 * The mark is inline SVG at 24px and the word is real HTML text, not the
 * `tally-lockup.svg` artifact. That file sets the word in a live SVG text node
 * with a `font-family`, so it re-renders in whatever fallback face the viewer has
 * and its metrics move; it stays the standalone asset for contexts needing one
 * file. Here the word is selectable, scales with the type ramp, and honours the
 * three brand rules directly: not tinted emerald, not set in mono, and the mark
 * never sits on an accent fill.
 *
 * `workspace.json` is the substrate, not the application, so it never appears
 * here. It is named in the footer, in the sentence that says what tally is.
 */
function Wordmark() {
  return (
    <p className="wordmark">
      <svg className="wordmark__mark" viewBox="0 0 104 96" width="36" height="33" aria-hidden="true" focusable="false">
        <g fill="#00c896">
          <rect x="6" y="6" width="7" height="84" /><rect x="6" y="6" width="22" height="7" /><rect x="6" y="83" width="22" height="7" />
          <rect x="91" y="6" width="7" height="84" /><rect x="76" y="6" width="22" height="7" /><rect x="76" y="83" width="22" height="7" />
        </g>
        <g fill="currentColor">
          <rect x="32" y="18" width="7" height="60" /><rect x="45" y="18" width="7" height="60" />
          <rect x="58" y="18" width="7" height="60" /><rect x="71" y="18" width="7" height="60" />
        </g>
        <path d="M26 74 L84 38" stroke="currentColor" strokeWidth="7" />
      </svg>
      <span className="wordmark__word">tally</span>
      <span className="wordmark__rule" aria-hidden="true" />
      <span className="wordmark__product">Change impact cockpit</span>
    </p>
  );
}

export function CockpitShell({ model, route, onRouteChange, datasetKey, datasetOptions, onDatasetChange }: {
  model: CockpitViewModel;
  route: CockpitRoute;
  onRouteChange(route: CockpitRoute): void;
  datasetKey?: string;
  datasetOptions?: DatasetOption[];
  onDatasetChange?(key: string): void;
}) {
  const step = routes.findIndex((item) => item.route === route);
  const previous = step > 0 ? routes[step - 1] : null;

  return <MotionConfig reducedMotion="user"><main className="cockpit-shell">
    {model.sourceMode === "placeholder" && <p className="placeholder-banner" role="status">DESIGN PLACEHOLDER · NOT OBSERVED DATA</p>}

    {/*
      The app bar states what this surface does and nothing else.

      The trust pill it replaces glossed `workspace.json` in the one place a
      reader has not yet been given a reason to care, and the build claim it
      carried belongs to Receipts, where it can be checked. The standard is still
      one click away, from the footer, where the same sentence already names it.
    */}
    <header className="product-header">
      <Wordmark />
      <div className="product-header__aside">
        <p className="app-status">read-only review, nothing is applied here</p>
        <DatasetSelector datasetKey={datasetKey} options={datasetOptions} onChange={onDatasetChange} />
      </div>
    </header>

    {/*
      The rail sits directly under the app bar and above the subject, because it
      is chrome and the subject is the first piece of evidence. It used to follow
      the hero, which put a navigation control between the dataset name and the
      argument about it.
    */}
    <nav className="spine" aria-label="Review sequence">
      <ol>
        {routes.map(({ route: itemRoute, label, subtitle }, index) => (
          <li key={itemRoute} className={index === step ? "is-current" : index < step ? "is-done" : ""}>
            <button
              type="button"
              aria-current={route === itemRoute ? "step" : undefined}
              onClick={() => onRouteChange(itemRoute)}
            >
              <span className="spine__index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <span className="spine__label">{label}</span>
              <span className="spine__subtitle" aria-hidden="true">{subtitle}</span>
            </button>
          </li>
        ))}
      </ol>
      {/*
        Going back is navigation, so it lives in the navigation. As a button in
        the decision card it had the weight of a secondary action and competed
        with the one real choice on the screen.
      */}
      {previous && (
        <button className="spine__back" type="button" onClick={() => onRouteChange(previous.route)}>
          Back to {previous.label.toLowerCase()}
        </button>
      )}
    </nav>

    {/*
      The subject and the file it resolved to, on one line of the grid.

      This band carries the only display type on the screen. The radial glow that
      used to wash it is gone: it marked the band as chrome, and this band is the
      first evidence a reader meets rather than a header.

      It renders on every route. `route-slot` labels itself
      `aria-labelledby="route-title"`, so dropping the h1 on two of three routes
      would leave a dangling reference and a document with no heading, and the
      resolved-source block beside it is now the only statement of the
      resolution's standing that every route carries.
    */}
    <section className="hero" aria-label="Dataset under review">
      <div className="hero__identity">
        <p className="eyebrow"><Icon icon={Database} className="semantic-icon" /> <span>Evidence review, before any edit</span></p>
        <h1 id="route-title">{model.title}</h1>
        <p className="subject-urn">
          {model.datasetIdentityIdentifier ? (
            <ProofPopover
              label={model.datasetIdentityIdentifier.semanticLabel}
              value={model.datasetIdentity.text}
              identifierType={model.datasetIdentityIdentifier.type}
              copyLabel={model.datasetIdentityIdentifier.copyLabel ?? "Copy URN"}
              openUrl={model.datasetIdentityIdentifier.openUrl}
            />
          ) : (
            <span className="mono">{model.datasetIdentity.text}</span>
          )}
          <SourceTag source={model.datasetIdentity.source} />
        </p>
      </div>
      <ResolvedSource model={model} />
    </section>

    {/*
      Impact's first frame, in the order the spec reads it: who contributed what,
      then the decisive delta, then the decision, then the scope strip. Everything
      the route says beyond that is below, disclosed rather than stacked.
    */}
    {route === "impact" && (
      <>
        <ContributionBand model={model} />
        <PlanDelta model={model} onRouteChange={onRouteChange} heading="How joined evidence changed the agent's plan" />
        <DecisionBar model={model} route={route} onRouteChange={onRouteChange} />
        <ScopeStrip model={model} onRouteChange={onRouteChange} />
      </>
    )}

    <section className="route-slot" aria-labelledby="route-title">
      <div className={route === "receipts" ? "route-body route-body--indexed" : "route-body"}>
        <div className="route-body__main">
          {route === "impact" ? <ImpactView model={model} />
            : route === "change-plan" ? <ChangePlanView model={model} />
            : <ReceiptsView model={model} datasetKey={datasetKey} />}
        </div>
        {/*
          The rail survives on exactly one route, as the wayfinding it always was
          there. On the other two it held the decision, which is now a band under
          the evidence it decides on.
        */}
        {route === "receipts" && <DecisionRail />}
      </div>
    </section>

    {/*
      Change plan's forward move follows its plan rather than preceding it. Impact
      renders both of these inside the first frame, above; Receipts is terminal
      and states its coverage in full in the accounting section, so restating it
      here would be the same fact twice on one route.
    */}
    {route === "change-plan" && (
      <>
        <DecisionBar model={model} route={route} onRouteChange={onRouteChange} />
        <ScopeStrip model={model} onRouteChange={onRouteChange} />
      </>
    )}

    <footer className="cockpit-footer">
      <a className="cta" href="https://github.com/workspacejson/datahub-agent/blob/main/JUDGING.md" target="_blank" rel="noopener">Verify this yourself</a>
      <p className="cockpit-footer__role">
        Tally is the join between DataHub and{" "}
        <a
          href="https://github.com/workspacejson/standard"
          target="_blank"
          rel="noopener"
          aria-label="workspace.json standard on GitHub, opens in a new tab"
        >
          workspace.json
        </a>
        . Open-source, Apache 2.0.
      </p>
    </footer>
  </main></MotionConfig>;
}
