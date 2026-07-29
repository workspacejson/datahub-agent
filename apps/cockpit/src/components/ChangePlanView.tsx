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
 *
 * Two panels, not tabs. The toggle between modes is a comparison rather than a
 * choice, and a tab would hide half the evidence, which is the whole argument.
 * The parity strip above them shows the values that must match rather than
 * asserting they do: if the task, model or event digest ever differed, the
 * comparison would be void, and a reader can only check that against values.
 */
export function ChangePlanView({ model }: { model: CockpitViewModel }) {
  const comparison = model.planComparison;

  if (comparison.state === "unavailable") {
    return (
      <section aria-label="Plan comparison">
        <h2>Changed plan</h2>
        <p className="comparison-unavailable">No plan comparison available. {comparison.reason}</p>
      </section>
    );
  }

  return (
    <section aria-label="Plan comparison">
      <div className="parity-strip" aria-label="Held constant across both modes">
        <div>
          <span className="parity-label">Task</span>
          <span className="parity-value">{comparison.taskId}</span>
        </div>
        <div>
          <span className="parity-label">Model</span>
          <span className="parity-value">{comparison.model}</span>
        </div>
        <div>
          <span className="parity-label">Bound to event</span>
          <span className="parity-value">{comparison.eventDigest}</span>
        </div>
      </div>

      <div className="comparison">
        <article className="plan-panel">
          <p className="eyebrow">DataHub only</p>
          <h3>Declared context alone</h3>
          {/* Index keys: two plan steps may legitimately carry identical text, and the
              list is static per render, so position is the stable identity. */}
          <ol>{comparison.datahubOnlySteps.map((step, index) => <li key={index}>{step}</li>)}</ol>
        </article>
        <article className="plan-panel plan-panel--joined">
          <p className="eyebrow">Joined context</p>
          <h3>Declared context plus repository evidence</h3>
          <ol>{comparison.joinedSteps.map((step, index) => <li key={index}>{step}</li>)}</ol>
        </article>
      </div>

      <h2>Changed plan</h2>
      {comparison.deltas.length === 0 ? (
        <p className="comparison-no-delta">
          The comparison ran and found no semantic difference: the joined repository
          evidence did not change the plan.
        </p>
      ) : (
        <ul className="delta-list">
          {comparison.deltas.map((delta) => (
            <li className="delta" key={`${delta.kind}-${delta.label}`}>
              <span className="delta__kind">{delta.kind}</span>
              <span className="delta__label">{delta.label}</span>
              <p className="delta__reason">{delta.reason}</p>
              <SourceTag source={delta.source} />
              <span className="evidence-refs">Evidence: {delta.evidenceRefs.join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
