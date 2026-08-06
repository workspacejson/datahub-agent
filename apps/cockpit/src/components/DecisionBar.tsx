import type { CockpitRoute, CockpitViewModel } from "../model/cockpit-view-model";

/**
 * The one decision, as a band across the frame rather than a card in a rail.
 *
 * The sticky aside it replaces carried three things at primary weight -- the
 * named gaps, the consequence of proceeding, and the two controls -- in a 20rem
 * column beside the evidence they were about. Reading the decision meant reading
 * a second column, and the gap list competed with the action for the same
 * attention. The names now sit in the scope strip, which is where coverage is
 * stated, and this band carries only what proceeding accepts and the controls
 * that proceed.
 *
 * The consequence is in the same sentence that asks for the decision, so consent
 * is informed at the moment it is given rather than 900px away. `first-frame.spec.ts`
 * asserts the band clears the fold with headroom at both required viewports.
 */

/** What proceeding accepts, composed from the count rather than asserted. */
function consequence(model: CockpitViewModel): string {
  const gaps = model.receipt.statedGaps.length;
  if (gaps === 0) return "No gaps are stated. Proceeding accepts the review as it stands.";
  return `Proceeding accepts ${gaps} stated gap${gaps === 1 ? "" : "s"}.`;
}

export function DecisionBar({ model, route, onRouteChange }: {
  model: CockpitViewModel;
  route: CockpitRoute;
  onRouteChange(route: CockpitRoute): void;
}) {
  const impact = route === "impact";
  return (
    <section className="decision-bar" aria-label="Stated gaps and next action">
      <div className="decision-bar__ask">
        <p className="decision-bar__title">
          {impact
            ? "Decide: apply this evidence-constrained plan, or stop here"
            : "Next: check the receipt behind every claim above"}
        </p>
        {/*
          `.rail-caveat` keeps its class name. It is the one string on this band
          that can grow at runtime, so `first-frame.spec.ts` grows it and checks
          the controls still clear the fold; renaming it would quietly retire
          that guard rather than move it.
        */}
        <p className="rail-caveat">
          {consequence(model)}
          {impact ? " Stopping records nothing and applies nothing." : ""}
        </p>
      </div>
      {/*
        One primary action per view. Impact is the only route with a real choice,
        so it is the only one that offers two controls; stop is a full-sized
        target in outline rather than a link, because declining has to be as
        reachable as proceeding.
      */}
      <div className="decision-bar__actions">
        {impact ? (
          <>
            <button className="cta cta--secondary" type="button" onClick={() => onRouteChange("receipts")}>Stop, do not edit</button>
            <button className="cta" type="button" onClick={() => onRouteChange("change-plan")}>Continue to change plan</button>
          </>
        ) : (
          <button className="cta" type="button" onClick={() => onRouteChange("receipts")}>Review receipts</button>
        )}
      </div>
    </section>
  );
}
