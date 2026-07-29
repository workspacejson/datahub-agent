import type { CockpitRoute, CockpitViewModel } from "../model/cockpit-view-model";

/**
 * The named gaps, the sentence that says what proceeding accepts, and the one
 * action that proceeds.
 *
 * It is a rail rather than a footer because of where it has to be readable. The
 * primary action used to sit at the end of the Impact column, at `y = 1378` on a
 * 1533px page: 478px below a 1440x900 fold and 578px below a 1280x800 one. HAC-228
 * shows a cold reader the first frame for five seconds and forbids scrolling, then
 * asks what the next action is, so an action below the fold is an action that does
 * not exist for the question being asked.
 *
 * Unresolved items are named here at body size, not summarised into a count and
 * not hidden behind a tooltip. A count says how much is missing; only the names
 * say what, and what is the half a reader can act on.
 */

/** What proceeding accepts, composed from the counts rather than asserted. */
function caveat(model: CockpitViewModel): string {
  const gaps = model.receipt.statedGaps.length;
  const coverage = model.completeness === "complete-against-pinned-manifest"
    ? "Coverage is complete against the pinned manifest"
    : "Coverage is not established";
  if (gaps === 0) return `${coverage}, and no gaps are stated.`;
  return `${coverage}, and ${gaps} item${gaps === 1 ? " is" : "s are"} stated as a gap. Proceeding accepts that.`;
}

export function DecisionRail({ model, route, onRouteChange }: {
  model: CockpitViewModel;
  route: CockpitRoute;
  onRouteChange(route: CockpitRoute): void;
}) {
  const gaps = model.receipt.statedGaps;
  return (
    <aside className="decision-rail" aria-label="Stated gaps and next action">
      <div className="rail-group">
        <p className="eyebrow">Stated gaps, named</p>
        {gaps.length === 0 ? (
          <ul><li>No gaps are stated for this event.</li></ul>
        ) : (
          <ul>
            {gaps.map((gap) => (
              <li key={gap.field}>
                <strong>{gap.field}</strong>
                {gap.reason}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        One decision per view, and the caveat sits directly above the control
        that executes it so accepting the gap cannot be skipped past. Receipts is
        terminal: it offers a way back and no forward action, because there is
        nothing left to approve there.
      */}
      <div className="rail-group">
        <p className="rail-caveat">{caveat(model)}</p>
        {route === "impact" && (
          <>
            {/*
              "Continue to change plan", not HAC-217's "Review changed plan".
              HAC-217 froze that label before any screen existed; the approved
              design named this one with the frame in front of it, and it says
              what happens next rather than what you will do once you arrive.
              HAC-218's issue text is amended to match rather than left to
              contradict the artifact.
            */}
            <button className="cta" type="button" onClick={() => onRouteChange("change-plan")}>Continue to change plan</button>
            <button className="cta cta--secondary" type="button" onClick={() => onRouteChange("receipts")}>Stop, do not edit</button>
          </>
        )}
        {route === "change-plan" && (
          <>
            <button className="cta" type="button" onClick={() => onRouteChange("receipts")}>Review receipts</button>
            <button className="cta cta--secondary" type="button" onClick={() => onRouteChange("impact")}>Back to impact</button>
          </>
        )}
        {route === "receipts" && (
          <button className="cta cta--secondary" type="button" onClick={() => onRouteChange("change-plan")}>Back to change plan</button>
        )}
      </div>
    </aside>
  );
}
