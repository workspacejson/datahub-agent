import type { CockpitViewModel, EvidenceValue } from "../model/cockpit-view-model";
import { Database, FileSearch2, GitMerge, Link2 } from "lucide-react";
import { Icon } from "./Icon";
import { ProofPopover } from "./ProofPopover";
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
/**
 * Which control dimensions this run can actually attest, and whether all of them
 * hold.
 *
 * Fail-closed on purpose. The visible assertion above the panels is what makes
 * the comparison readable as evidence rather than as two lists side by side, so
 * it may only appear when every dimension it names is observed. `placeholder` and
 * `unavailable` both count as not established: a placeholder is a shape standing
 * in for a value, and asserting fairness from one would be asserting it from
 * nothing.
 *
 * Task, model and event digest are schema-guaranteed on an observed comparison,
 * so they cannot fail here; they are listed anyway because the copy names them
 * and a later schema change that relaxed them should surface here rather than
 * silently narrow what the sentence covers. The prompt is not a separate field:
 * it is bound by the event digest, which is why the copy says so rather than
 * claiming a dimension the model does not carry.
 */
function parityControls(model: CockpitViewModel, comparison: Extract<CockpitViewModel["planComparison"], { state: "observed" }>) {
  const { subjectRevision, dataHubReadParameters } = model.receipt.provenance;
  const dimensions = [
    { label: "task", held: comparison.taskId.length > 0 },
    { label: "model", held: comparison.model.length > 0 },
    { label: "analysis event", held: comparison.eventDigest.length > 0 },
    { label: "DataHub read", held: dataHubReadParameters.state === "observed" },
    { label: "repository revision", held: subjectRevision.state === "observed" },
  ];
  const missing = dimensions.filter((dimension) => !dimension.held).map((dimension) => dimension.label);
  return { established: missing.length === 0, missing };
}

/** "a", "a and b", "a, b and c" — the missing dimensions read as a sentence. */
function formatList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The first entry of a plan, promoted so the two plans can be compared without
 * reading both lists to the bottom. It is labelled as what it is: the first
 * planned action, not the plan's decision.
 */
function firstAction(steps: string[]) {
  if (steps.length === 0) return null;
  return (
    <div className="first-action">
      <p className="first-action__label">First planned action</p>
      <p className="first-action__value">{steps[0]}</p>
    </div>
  );
}

/** A control dimension in the disclosure, showing its state when it has no value. */
function ParityValue({ value }: { value: EvidenceValue }) {
  if (value.state === "observed") return <span className="parity-value">{value.value}</span>;
  if (value.state === "placeholder") return <span className="parity-value parity-value--open">{value.value}</span>;
  return <span className="parity-value parity-value--open">Not attested. {value.reason}</span>;
}

export function ChangePlanView({ model }: { model: CockpitViewModel }) {
  const comparison = model.planComparison;
  const { provenance } = model.receipt;

  if (comparison.state === "unavailable") {
    return (
      <section aria-label="Plan comparison">
        <h2>Changed plan</h2>
        <p className="comparison-unavailable">No plan comparison available. {comparison.reason}</p>
      </section>
    );
  }

  const parity = parityControls(model, comparison);
  const [firstDatahub] = comparison.datahubOnlySteps;
  const [firstJoined] = comparison.joinedSteps;
  const firstStepChanged = firstDatahub !== undefined && firstJoined !== undefined && firstDatahub !== firstJoined;

  return (
    <section aria-label="Plan comparison">
      {/*
        Causal copy is gated on the controls. "What the join added" says the
        workspace context is what changed the plan, which is only sayable if the
        run held everything else constant. When it did not, the plans are still
        worth showing -- they are what was recorded -- but the sentence that
        explains them is not.
      */}
      <p className="route-intro">
        {parity.established
          ? "What the join added: the exact repository path and pinned revision."
          : "The two plans as recorded. What differs is shown; why it differs is not asserted."}
      </p>

      {/*
        The assertion stays visible; only its verification collapses. Hiding the
        fact that the comparison was controlled would hide the condition that
        makes the two panels mean anything, which is the opposite of what
        progressive disclosure is for. The identifiers behind it are verification
        detail and belong one level down.
      */}
      <p className={parity.established ? "parity-claim" : "parity-claim parity-claim--open"}>
        {parity.established ? (
          <>
            <strong>Controlled comparison:</strong> same task, model and prompt, bound to one
            analysis event, against the same DataHub read and repository revision. Only the
            workspace context differs.
          </>
        ) : (
          <>
            <strong>Comparison controls not established.</strong> This run does not attest{" "}
            {formatList(parity.missing)}, so nothing here claims the workspace context is what
            changed the plan.
          </>
        )}
      </p>

      <details className="parity-detail">
        <summary>How this comparison was controlled</summary>
      <div className="parity-strip" aria-label="Values held constant, so the comparison can be checked rather than trusted">
        <div>
          <span className="parity-label">Task</span>
          <span className="parity-value">{comparison.taskId}</span>
        </div>
        <div>
          <span className="parity-label">Model</span>
          <span className="parity-value">{comparison.model}</span>
        </div>
        <div className="parity-strip__binding">
          <span className="parity-label"><Icon icon={Link2} className="semantic-icon" /> <span>Bound to this analysis event</span></span>
          {comparison.eventDigestIdentifier ? (
            <ProofPopover
              label="Inspect proof"
              value={comparison.eventDigest}
              identifierType={comparison.eventDigestIdentifier.type}
              copyLabel={comparison.eventDigestIdentifier.copyLabel ?? "Copy digest"}
              openUrl={comparison.eventDigestIdentifier.openUrl}
              icon={FileSearch2}
            />
          ) : (
            <span className="parity-value">{comparison.eventDigest}</span>
          )}
        </div>
        {/* The two dimensions the copy names that are not on the comparison
            record. Both can fail to be attested, which is what the fail-closed
            check reads, so both are shown with their state rather than omitted
            when absent. */}
        <div>
          <span className="parity-label">DataHub read</span>
          <ParityValue value={provenance.dataHubReadParameters} />
        </div>
        <div>
          <span className="parity-label">Repository revision</span>
          <ParityValue value={provenance.subjectRevision} />
        </div>
      </div>
      </details>

      {/*
        "First step changed", not "decision changed". The two values below are
        the first entry of each plan and nothing in the model calls either one a
        decision -- naming them that would assert a disposition the artifact does
        not record, and it would put a second source of truth beside the step
        lists that could contradict them. The label states exactly what was
        compared, and only when the two actually differ.
      */}
      {firstStepChanged && <p className="reversal-label">First step changed</p>}

      <div className="comparison">
        <article className="plan-panel">
          <p className="eyebrow"><Icon icon={Database} className="semantic-icon" /> <span>DataHub only</span></p>
          <h3>Declared context alone</h3>
          {firstAction(comparison.datahubOnlySteps)}
          {/* Index keys: two plan steps may legitimately carry identical text, and the
              list is static per render, so position is the stable identity. */}
          <ol>{comparison.datahubOnlySteps.map((step, index) => <li key={index}>{step}</li>)}</ol>
        </article>
        <article className="plan-panel plan-panel--joined">
          <p className="eyebrow"><Icon icon={GitMerge} className="semantic-icon" /> <span>Joined context</span></p>
          <h3>Declared context plus repository evidence</h3>
          {firstAction(comparison.joinedSteps)}
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
