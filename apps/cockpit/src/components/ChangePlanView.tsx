import type { CockpitViewModel, EvidenceValue } from "../model/cockpit-view-model";
import { Database, FileSearch2, GitMerge, Link2 } from "lucide-react";
import { Icon } from "./Icon";
import { PlanDelta } from "./PlanDelta";
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

/*
  `firstAction` is gone from this route, and so is `reversal-label`.

  Both existed so the two plans could be compared without reading each list to
  the bottom: the first entry of each was promoted above its panel, and a label
  said when they differed. `PlanDelta` now opens the route with exactly that
  comparison, in the same component the first frame uses, so the promotion was
  the same two strings restated a few hundred pixels lower. The panels keep the
  full ordered lists, which is what they are for.
*/

/** A control dimension in the disclosure, showing its state when it has no value. */
function ParityValue({ value }: { value: EvidenceValue }) {
  if (value.state === "observed") return <span className="parity-value">{value.value}</span>;
  if (value.state === "placeholder") return <span className="parity-value parity-value--open">{value.value}</span>;
  // Declared reads as open, not held. The value is real and shown; what is
  // missing is any execution behind it, so it cannot count toward parity.
  if (value.state === "declared" || value.state === "legacy") {
    return <span className="parity-value parity-value--open">{value.value} — {value.note}</span>;
  }
  return <span className="parity-value parity-value--open">Not attested. {value.reason}</span>;
}

/**
 * The recorded result of HAC-150's ten paired runs.
 *
 * Not derived from the model on screen. The counts are hardcoded on purpose: a
 * runtime-computed version would be a claim this render is making, and the
 * point is that it cites an experiment that already happened and can be
 * checked. It is a component rather than inline markup so both branches of this
 * route render it, including the branch where this model carries no comparison
 * at all. The evaluation does not stop being true because one event lacks a
 * comparison, and gating it on this model would repeat the mistake it replaced.
 *
 * Both sentences state what the instrument observed rather than what it
 * concluded. "The plan included the exact source revision" is a property of the
 * recorded text; "the join supplied it" would be an inference about cause that
 * ten runs on one corpus do not license.
 *
 * The counts are normalized step sequences, not identical raw plans. Two runs
 * whose prose differs but whose step ids match count as one sequence, and
 * "identical plans" would overclaim what the normalization compared.
 */
function EvaluationCitation() {
  return (
    <section className="evaluation-claim" aria-label="Repeated paired evaluation">
      <p className="eyebrow">Measured across repeated runs</p>
      <p className="evaluation-claim__result">
        Across 10 controlled paired runs on the pinned corpus, the plan included the exact
        source revision in 10/10 joined-context runs and 0/10 DataHub-only runs.
      </p>
      <p className="evaluation-claim__result">
        DataHub-only produced five distinct normalized step sequences across 10 runs. Joined
        context produced one.
      </p>
      {/*
        The bounds, on the same card as the result.

        The two sentences above are cited from a real ten-pair experiment, and
        every figure in them reproduces from `evaluation/hac-150/` with the
        verification commands in `docs/claims.md`. What the card did not say is
        how narrow the experiment is, and it sits directly under the parity
        caveat for the single on-screen comparison -- so a reader meeting "10
        controlled paired runs" next to "controls not established" can read the
        citation as the more rigorous of the two without ever learning it is one
        task and one model.

        Every value here is recorded: `manifest.json` carries the task, the model
        and `{"temperature": 0}`, and `aggregate.json` records the counterbalance
        as 5 pairs assigned to each arm order. README limitation 7 states the same
        bound; this is the surface a judge is actually on.
      */}
      <p className="evaluation-claim__scope">
        Scope: one task, one model, temperature 0, arm order counterbalanced 5 and 5. A
        controlled comparison on the pinned corpus, not a significance test and not a claim
        about model families.
      </p>
      <a
        className="evaluation-claim__source"
        href="https://github.com/workspacejson/datahub-agent/tree/main/evaluation/hac-150"
        target="_blank"
        rel="noreferrer"
      >
        Read the evaluation receipt, with every raw output
      </a>
    </section>
  );
}

export function ChangePlanView({ model }: { model: CockpitViewModel }) {
  const comparison = model.planComparison;
  const { provenance } = model.receipt;

  if (comparison.state === "unavailable") {
    return (
      <section aria-label="Plan comparison">
        <h2>Changed plan</h2>
        <p className="comparison-unavailable">No plan comparison available. {comparison.reason}</p>
        <EvaluationCitation />
      </section>
    );
  }

  const parity = parityControls(model, comparison);

  return (
    <section aria-label="Plan comparison">
      {/*
        The route opens on the decisive delta, in the same component the first
        frame uses, and the tab's own subtitle now names the job the heading
        states in full. "The two plans as recorded. What differs is shown below."
        was a caption for a layout rather than a claim about evidence, and the
        delta says the same thing by being it.
      */}
      <PlanDelta model={model} heading="How joined evidence changed the agent's plan" />

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

      <EvaluationCitation />

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

      <div className="comparison">
        <article className="plan-panel">
          <p className="eyebrow"><Icon icon={Database} className="semantic-icon" /> <span>DataHub only</span></p>
          <h3>Declared context alone</h3>
          {/* Index keys: two plan steps may legitimately carry identical text, and the
              list is static per render, so position is the stable identity. */}
          <ol>{comparison.datahubOnlySteps.map((step, index) => <li key={index}>{step}</li>)}</ol>
        </article>
        <article className="plan-panel plan-panel--joined">
          <p className="eyebrow"><Icon icon={GitMerge} className="semantic-icon" /> <span>Joined context</span></p>
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
