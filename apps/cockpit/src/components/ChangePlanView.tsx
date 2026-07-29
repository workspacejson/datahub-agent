import type { CockpitViewModel } from "../model/cockpit-view-model";
import { SourceTag } from "./SourceTag";

/**
 * The DataHub-only/joined comparison, or the stated reason there isn't one.
 *
 * The two branches are deliberately different renderings rather than one list
 * that happens to be empty. An absent comparison is not a plan with no changes,
 * and a viewer who cannot tell those apart has learned nothing from the screen
 * whose entire job is to show that joining repository evidence changed the plan.
 *
 * An observed comparison with no deltas is a real result and says so, instead of
 * rendering as blank space a reader would read as a failure to load.
 */
export function ChangePlanView({ model }: { model: CockpitViewModel }) {
  const comparison = model.planComparison;
  return (
    <section aria-label="Plan comparison">
      <div className="comparison">
        <p><b>DataHub-only</b> catalogue and lineage context.</p>
        <p><b>Joined</b> repository evidence after safe resolution.</p>
      </div>
      <h2>Changed plan</h2>
      {comparison.state === "unavailable" ? (
        <p className="comparison-unavailable">No plan comparison available — {comparison.reason}</p>
      ) : (
        <>
          <p>
            Task <code>{comparison.taskId}</code> under model <code>{comparison.model}</code>,
            bound to event <code>{comparison.eventDigest}</code>.
          </p>
          {comparison.deltas.length === 0 ? (
            <p className="comparison-no-delta">
              The comparison ran and found no semantic difference: the joined repository
              evidence did not change the plan.
            </p>
          ) : (
            <ul>
              {comparison.deltas.map((delta) => (
                <li key={`${delta.kind}-${delta.label}`}>
                  <b>{delta.kind}</b>: {delta.label} — {delta.reason}{" "}
                  <SourceTag source={delta.source} />
                  <span className="evidence-refs"> Evidence: {delta.evidenceRefs.join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
