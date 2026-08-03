import type { CockpitViewModel } from "../model/cockpit-view-model";

/**
 * The six outcomes of a review, held on screen on every route.
 *
 * Before this, a reader had to be on Impact to know the source resolved and on
 * Receipts to know what was not established. The bar states both everywhere, so
 * moving between routes never loses the standing of the review.
 *
 * Every cell is derived from the model at render. None of these are contract
 * fields: a count that can be recomputed from recorded data is presentation, and
 * adding it to the contract would create a second place for it to disagree.
 */

/** A 40-character SHA shortened for the interface. Anything else renders whole. */
function shortRevision(value: string): string {
  return /^[0-9a-f]{40}$/i.test(value) ? value.slice(0, 8) : value;
}

function sourceCell(model: CockpitViewModel): string {
  const revision = model.receipt.provenance.subjectRevision;
  const pinned = revision.state === "observed" || revision.state === "placeholder"
    ? ` at ${shortRevision(revision.value)}`
    : "";
  if (model.resolutionDisposition === "exact") return `Exact file resolved${pinned}`;
  // The disposition word is the vocabulary term, so it is the value, not a gloss
  // on it. Ambiguous, unavailable, mismatch and indeterminate each mean something
  // the reader can look up; a friendlier synonym would lose that.
  return `Resolution ${model.resolutionDisposition}${pinned}`;
}

function lineageCell(model: CockpitViewModel): string {
  const upstream = model.impactEdges.filter((edge) => edge.direction === "upstream").length;
  const downstream = model.impactEdges.filter((edge) => edge.direction === "downstream").length;
  return `${upstream} upstream, ${downstream} downstream`;
}

function planCell(model: CockpitViewModel): string {
  if (model.planComparison.state !== "observed") return "Not compared";
  const count = model.planComparison.deltas.length;
  // A comparison that ran and found nothing is a result, not an absence, so it
  // reads as one and stays off the amber ramp. HAC-152 settled this.
  return count === 0 ? "No delta recorded" : `Changed: ${count} recorded`;
}

const WRITEBACK_LABEL: Record<CockpitViewModel["receipt"]["writeback"]["terminalDisposition"], string> = {
  "not-applicable": "Not attempted",
  success: "Observed in DataHub",
  "accepted-not-observed": "Accepted, not observed",
  failed: "Failed",
  noop: "Already in intended state",
  indeterminate: "Indeterminate",
  contradictory: "Contradictory",
};

export function OutcomeBar({ model }: { model: CockpitViewModel }) {
  const coverageOpen = model.completeness !== "complete-against-pinned-manifest";
  const gaps = model.receipt.statedGaps.length;

  const cells = [
    { label: "Source", value: sourceCell(model) },
    { label: "Lineage", value: lineageCell(model) },
    {
      label: "Coverage",
      value: coverageOpen ? "Not established" : "Complete against pinned manifest",
      open: coverageOpen,
    },
    { label: "Plan", value: planCell(model) },
    { label: "Writeback", value: WRITEBACK_LABEL[model.receipt.writeback.terminalDisposition] },
    { label: "Limitations", value: gaps === 0 ? "None named" : `${gaps} named` },
  ];

  return (
    <dl className="outcome-bar" aria-label="Standing of this review">
      {cells.map(({ label, value, open }) => (
        <div className={open ? "outcome-cell outcome-cell--open" : "outcome-cell"} key={label}>
          <dt className="outcome-cell__label">{label}</dt>
          <dd className="outcome-cell__value">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
