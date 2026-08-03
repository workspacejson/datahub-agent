import type { CockpitRoute, CockpitViewModel } from "../model/cockpit-view-model";
import { Database } from "lucide-react";
import { MotionConfig } from "motion/react";
import { ChangePlanView } from "./ChangePlanView";
import { DecisionRail } from "./DecisionRail";
import { Icon } from "./Icon";
import { ImpactView } from "./ImpactView";
import { OutcomeBar } from "./OutcomeBar";
import { ProofPopover } from "./ProofPopover";
import { ReceiptsView } from "./ReceiptsView";
import { SourceTag } from "./SourceTag";
import type { DatasetOption } from "../data/select-adapter";
import { TermDefinition } from "./TermDefinition";

function SilentZeroCallout({ model }: { model: CockpitViewModel }) {
  const dbtPath = model.dbtFilePath;
  const prefix = model.projectPrefix;

  if (!dbtPath || !prefix) return null;

  return (
    <article className="silent-zero silent-zero--inline" aria-label="Silent zero: naive join failure">
      <p className="silent-zero__result">
        <TermDefinition term="Naive join" definition="A direct path lookup with no prefix normalization: the dbt path is compared to the repository path exactly as each system spells it." />: 0 matches. No error. No warning. Exit code 0.
      </p>
      <p className="silent-zero__path">
        dbt: {dbtPath} | workspace.json: {prefix}/{dbtPath}
      </p>
    </article>
  );
}

function ResolvedPathSummary({ model }: { model: CockpitViewModel }) {
  if (model.resolutionDisposition !== "exact") return null;
  return (
    <article className="resolved-summary" aria-label="Resolved path via manifest join">
      <p className="resolved-summary__result">
        Resolved: <span className="mono">{model.producerPath.text}</span>
      </p>
      <p className="resolved-summary__method">via <TermDefinition term="manifest-join" definition="Reading the dbt manifest to learn the project prefix, then normalizing it away so the DataHub path and the repository path resolve to the same file." /></p>
    </article>
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
 */
const routes: Array<{ route: CockpitRoute; label: string }> = [
  { route: "impact", label: "Impact" },
  { route: "change-plan", label: "Change plan" },
  { route: "receipts", label: "Receipts" },
];

const READ_LABEL: Record<CockpitViewModel["read"], string> = {
  ok: "returned",
  failed: "failed",
  "not-queried": "was never made",
};

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
 * `workspace.json` is the substrate, not the application, so it appears as an
 * endorsement on the right rather than as the wordmark on the left.
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

/**
 * Coverage, stated once, here.
 *
 * It used to be asserted twice: this panel, and a sentence in the rail 900px
 * away restating the same fact in different words, on all three routes. Neither
 * was authoritative and a reviewer trusted it less each time they met it. This
 * is the only place coverage is asserted; the rail carries the consequence.
 *
 * The counters are four figures on one rule rather than a bordered panel with a
 * nested grid. They are one line of information and do not need a second border.
 *
 * A live region, inherited from the chip strip this replaced: the panel changes
 * when the route or the model changes and neither reloads the page, so without it
 * a screen-reader user is told the route changed and not that the evidence state
 * under it did.
 */
function Coverage({ model }: { model: CockpitViewModel }) {
  const { accounting } = model.receipt;
  const complete = model.completeness === "complete-against-pinned-manifest";
  /*
    The headline and its eyebrow used to sit at the top of this block, stating
    completeness in the same words the outcome bar now uses. Two renderings of
    one fact on one route is what `house-copy.test.tsx` forbids, and the bar
    states it on every route rather than only where the hero renders, so the bar
    is the one that keeps it.

    The note stays. It is not a restatement: the bar gives the state, this gives
    the consequence, that an absent edge is not evidence of no impact, which is
    the part a reader cannot derive from the words "not established". Same
    division HAC-218 settled for the gap rows: short state tag, explanation in
    muted body text.
  */
  return (
    <div className="coverage" aria-label="Coverage of this review" aria-live="polite">
      {/*
        "that set", not "the set". The counters sit three inches below this
        sentence, and a reader who has just crossed 1/1 supplies the nearest
        referent for a bare "the set" — the path set, which is complete — and
        reads the note as contradicting the headline. "that" is anaphoric and can
        only bind to what the preceding sentence says the read returned, which is
        the other denominator. The fix is the pronoun, not a qualifying clause:
        the clause was already tried and rejected for the evidence tier, and a
        sentence restating the counters is the double assertion this panel exists
        to avoid.
      */}
      <p className="coverage__note">
        The lineage read {READ_LABEL[model.read]}.{" "}
        {complete
          ? "That set is complete against the pinned manifest."
          : "Whether that set is complete is not established, so an absent edge is not evidence of no impact."}
      </p>
      {/*
        "files", not "paths". This counter sits under a headline about lineage
        completeness, and in that neighbourhood "path" reads as a graph path
        between datasets. It is not: it counts datasets whose repository source
        file was resolved, which is the other denominator entirely — the same
        confusion the note's pronoun fixes, arriving by a different word.

        "source paths resolved" was the obvious repair and is the one wording
        that cannot ship: measured, it wraps the strip onto a second row. So does
        "source files resolved" under a wide fallback face. "files resolved" is
        the same length as the label it replaces and renders *narrower*, so the
        strip keeps more slack than it has today under every face tested — which
        matters because `tokens/fonts.css` resolves these through a system stack
        on purpose, and the metrics move per machine.

        The fourth counter stays "path resolution". It reads against the word
        `exact` and is about resolution quality, not about a set of edges.
      */}
      <dl className="coverage__counts">
        <div>
          <dt>{accounting.datasetsResolved}<span className="coverage__of">/{accounting.datasetsRequested}</span></dt>
          <dd>files resolved</dd>
        </div>
        <div>
          <dt>{accounting.datasetsUnresolved}</dt>
          <dd>unresolved</dd>
        </div>
        <div>
          <dt className="coverage__count--open">{model.receipt.statedGaps.length}</dt>
          <dd>gaps, each named</dd>
        </div>
        <div>
          <dt className="coverage__count--word">{model.resolutionDisposition}</dt>
          <dd>path resolution</dd>
        </div>
      </dl>
    </div>
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

    <header className="product-header">
      <Wordmark />
      {/*
        The endorsement names a standard, so it resolves to the standard.

        It was a bare <b>: the one term on this page a reader is least likely to
        already know, styled like a proper noun and pointing nowhere. A judge
        asking "what is workspace.json" had to leave and search for it.

        A plain followed link, deliberately — no rel="nofollow". This is a
        first-party reference to the specification the product is built on, and
        the anchor text is the term itself, which is what a reader and a crawler
        both need it to say. New tab because the cockpit is a working surface and
        a reviewer mid-review should not lose their place; the accessible name
        keeps the visible text as its prefix, so speech input still matches it.
      */}
      <p className="endorsement">
        built on{" "}
        <a
          href="https://github.com/workspacejson/standard"
          target="_blank"
          rel="noopener"
          aria-label="workspace.json standard on GitHub, opens in a new tab"
        >
          workspace.json
        </a>
        <span className="endorsement__subtitle">a <TermDefinition term="repo-evidence artifact" definition="A JSON file committed to the repository and pinned to a Git commit, recording what the repository knows about itself: its source tree, its producing files, and the revision they were read at." /> at a pinned commit</span>
      </p>
      <DatasetSelector datasetKey={datasetKey} options={datasetOptions} onChange={onDatasetChange} />
    </header>

    <OutcomeBar model={model} />

    {/*
      The glow and the scanline grid stop at the bottom of this band, so the eye
      reads the band as chrome and everything below it as data.
    */}
    <section className="hero" aria-label="Dataset under review">
      {/*
        The stakes sentence moved into `ImpactView`. It is the argument the
        Impact route makes, and stating it here put it *above* the sticky
        decision rail, so its height pushed the primary action toward the fold on
        every route including the two that do not make that argument. In the main
        column it sits beside the rail instead of over it, which is worth 50px at
        1280x800 and loses nothing: the sentence is unchanged and still leads the
        route it belongs to.
      */}
      <div className="hero__stakes-group">
        {(model.dbtFilePath && model.projectPrefix) || model.resolutionDisposition === "exact" ? (
          <div className="silent-zero-pair">
            <SilentZeroCallout model={model} />
            <ResolvedPathSummary model={model} />
          </div>
        ) : null}
      </div>
      <div className="hero__identity">
        <p className="eyebrow"><Icon icon={Database} className="semantic-icon" /> <span>DataHub dataset</span></p>
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
      <Coverage model={model} />
    </section>

    <nav className="spine" aria-label="Review sequence">
      <ol>
        {routes.map(({ route: itemRoute, label }, index) => (
          <li key={itemRoute} className={index === step ? "is-current" : index < step ? "is-done" : ""}>
            <button
              type="button"
              aria-current={route === itemRoute ? "step" : undefined}
              onClick={() => onRouteChange(itemRoute)}
            >
              <span className="spine__index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <span className="spine__label">{label}</span>
              {itemRoute === "receipts" && <span className="spine__subtitle" aria-hidden="true">every claim tied to a verification command</span>}
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

    <section className="route-slot" aria-labelledby="route-title">
      <div className="route-body">
        <div className="route-body__main">
          {route === "impact" ? <ImpactView model={model} />
            : route === "change-plan" ? <ChangePlanView model={model} />
            : <ReceiptsView model={model} datasetKey={datasetKey} />}
        </div>
        <DecisionRail model={model} route={route} onRouteChange={onRouteChange} />
      </div>
    </section>
    <footer className="cockpit-footer">
      <a className="cta" href="https://github.com/workspacejson/datahub-agent/blob/main/JUDGING.md" target="_blank" rel="noopener">Verify this yourself</a>
      <p className="cockpit-footer__role">Tally is the join between DataHub and workspace.json. Open-source, Apache 2.0.</p>
    </footer>
  </main></MotionConfig>;
}
