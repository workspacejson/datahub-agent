import type { CockpitRoute, CockpitViewModel } from "../model/cockpit-view-model";
import { GAP_SOURCE_LABEL } from "../model/cockpit-view-model";
import { SourceTag } from "./SourceTag";

/** The contract field the whole comparison turns on. */
const PRODUCER_PATH_FIELD = "code.repositoryRelativePath";

/**
 * The decisive difference, in three lines, before the full plan.
 *
 * One component, rendered on two routes. On Impact it is the product's claim and
 * carries the heading weight; on Change plan it is the section opener that the
 * recorded differences then itemise. Repetition across routes is orientation
 * rather than duplication -- within a single screen each fact still appears once,
 * which is what `house-copy.test.tsx` checks.
 *
 * Every line is a recorded value. `Without` and `With` are the first step of each
 * plan as the run produced it, not a paraphrase of the difference, and `Why` is
 * the stated gap that made them differ, carrying the system that could not supply
 * the field. Nothing here composes a sentence about what the join "achieved":
 * that claim belongs to the cited evaluation, which is bound to ten runs rather
 * than to this render.
 *
 * When no comparison was supplied the panel states that and stops. A fabricated
 * contrast on the one band whose entire job is to exhibit a real one would be
 * the worst possible place to invent.
 */
export function PlanDelta({ model, onRouteChange, heading }: {
  model: CockpitViewModel;
  /** Omitted on Change plan, where the full plan is already on the page. */
  onRouteChange?(route: CockpitRoute): void;
  heading?: string;
}) {
  const comparison = model.planComparison;
  const gap = model.receipt.statedGaps.find((item) => item.field === PRODUCER_PATH_FIELD);

  return (
    <section className="plan-delta" aria-label="How joined evidence changed the plan">
      {heading !== undefined && (
        <div className="plan-delta__head">
          <h2 className="plan-delta__heading">{heading}</h2>
          <p className="plan-delta__caption">the decisive difference, before the full plan</p>
        </div>
      )}

      {comparison.state === "unavailable" ? (
        <p className="comparison-unavailable">No plan comparison available. {comparison.reason}</p>
      ) : (
        <>
          {comparison.datahubOnlySteps.length > 0 && (
            <div className="plan-delta__row plan-delta__row--without">
              <p className="plan-delta__label">Without joined evidence</p>
              <p className="plan-delta__value">{comparison.datahubOnlySteps[0]}</p>
            </div>
          )}
          {comparison.joinedSteps.length > 0 && (
            <div className="plan-delta__row plan-delta__row--with">
              <p className="plan-delta__label">With joined evidence</p>
              <p className="plan-delta__value">
                {comparison.joinedSteps[0]}
                {/*
                  The attribution is on the row, not implied by its colour.
                  Emerald here means workspace.json contributed the material,
                  which is the only thing emerald is allowed to mean on this
                  surface; without the tag the fill could be read as "resolved",
                  and resolution has its own axis.
                */}
                <SourceTag source="Joined" />
              </p>
            </div>
          )}
        </>
      )}

      {gap && (
        <div className="plan-delta__row plan-delta__row--why">
          <p className="plan-delta__label">Why</p>
          {/*
            The recorded reason, attributed, and nothing composed on top of it.
            An earlier draft of this row reached for `repositoryEvidence`, which
            reads as the obvious "and here is what the artifact added" clause and
            is the wrong field: it carries the *partners* summary, so the row
            would have closed the plan-change argument with a co-change sentence
            the receipt explicitly disclaims.
          */}
          <p className="plan-delta__value plan-delta__value--why">
            <span className="plan-delta__system">{GAP_SOURCE_LABEL[gap.source]}</span> does not expose{" "}
            <span className="mono">{gap.field}</span>. {gap.detail}
            {onRouteChange && (
              <button className="plan-delta__link" type="button" onClick={() => onRouteChange("change-plan")}>
                See the full plan
              </button>
            )}
          </p>
        </div>
      )}
    </section>
  );
}
