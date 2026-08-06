import type { CockpitRoute, CockpitViewModel } from "../model/cockpit-view-model";
import { GAP_SOURCE_LABEL } from "../model/cockpit-view-model";

/**
 * Two named scopes and the residual names, last and quietest.
 *
 * One label, "coverage", used to sit over two different subjects: the requested
 * paths, which resolved exactly, and the lineage set, whose completeness is not
 * established. A reader met "1/1 resolved, exact" beside "coverage: not
 * established" and had to reconcile them, which reads as the surface
 * contradicting itself. Naming the scope removes the contradiction without
 * softening either claim, and both claims still appear in full.
 *
 * The residual names are visible without interaction, each with the system that
 * could not supply it. The reason and the detail behind each one live in the
 * leading band on Receipts, which is where a reviewer looks for what is missing
 * and where HAC-218 requires them to lead.
 *
 * The aria-label and the live region are inherited from the coverage panel this
 * replaces: the strip changes when the route or the model changes and neither
 * reloads the page, so without it a screen-reader user is told the route changed
 * and not that the evidence state under it did.
 */

const READ_LABEL: Record<CockpitViewModel["read"], string> = {
  ok: "returned",
  failed: "failed",
  "not-queried": "was never made",
};

export function ScopeStrip({ model, onRouteChange }: {
  model: CockpitViewModel;
  onRouteChange(route: CockpitRoute): void;
}) {
  const { accounting } = model.receipt;
  const gaps = model.receipt.statedGaps;
  const complete = model.completeness === "complete-against-pinned-manifest";

  return (
    <section className="scope-strip" aria-label="Coverage of this review" aria-live="polite">
      <div className="scope">
        <p className="eyebrow">Scope A · requested paths</p>
        {/*
          "files", not "paths", inside the sentence: under a heading about
          lineage the word "path" reads as a graph path between datasets, and
          this counts datasets whose repository source file was resolved. The
          scope name keeps the contract's own word; the sentence disambiguates it.
        */}
        <p className="scope__claim">
          {accounting.datasetsResolved} of {accounting.datasetsRequested} resolved,{" "}
          <span className="scope__disposition">{model.resolutionDisposition}</span>.{" "}
          {accounting.datasetsUnresolved} unresolved.
        </p>
      </div>

      <div className={complete ? "scope" : "scope scope--open"}>
        <p className="eyebrow">Scope B · lineage set</p>
        {/*
          "that set", not "the set". A reader who has just crossed 1/1 supplies
          the nearest referent for a bare "the set" -- the path set, which is
          complete -- and reads this as contradicting the cell beside it. "that"
          is anaphoric and can only bind to what the preceding clause says the
          read returned, which is the other denominator.
        */}
        <p className="scope__claim">
          The lineage read {READ_LABEL[model.read]}.{" "}
          {complete
            ? "That set is complete against the pinned manifest."
            : "Completeness not established. An absent edge is not evidence of no impact."}
        </p>
      </div>

      <div className="scope">
        {/*
          The link sits on the label line rather than under the list. Trailing the
          names it was the last thing in the frame and fell 2px under the fold at
          1280x800 -- and a route to the reasons that a reader has to scroll for is
          a route most readers will not find. On the label it is in frame at both
          viewports and reads as part of what the cell is, which is also what it
          is: the names here, the reasons one click away.
        */}
        <p className="scope__label">
          <span className="eyebrow">{gaps.length} named residual{gaps.length === 1 ? "" : "s"}</span>
          {gaps.length > 0 && (
            <button className="scope__explain" type="button" onClick={() => onRouteChange("receipts")}>
              Explain each
            </button>
          )}
        </p>
        {gaps.length === 0 ? (
          <p className="scope__claim">No gaps are stated for this event.</p>
        ) : (
          <>
            {/*
              Capped and scrollable. The count is contract-supplied and unbounded,
              and this strip sits below the decision band, so growth here cannot
              push the controls off the frame; the cap keeps the strip itself from
              becoming a list. `first-frame.spec.ts` grows it past the cap and
              asserts both.
            */}
            <ul className="scope__residuals">
              {gaps.map((gap) => (
                /*
                  Keyed on source and field together. The contract permits two
                  stated gaps for one field from different systems -- "DataHub
                  does not expose this" and "the artifact could not resolve it"
                  are different findings the receipt keeps separate -- and a bare
                  field key would collide on exactly that pair.
                */
                <li key={`${gap.source}:${gap.field}`}>
                  <span className="mono">{gap.field}</span>
                  <span className="scope__source">{GAP_SOURCE_LABEL[gap.source]}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
