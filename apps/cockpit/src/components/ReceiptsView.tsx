import type { CockpitViewModel, EvidenceValue, StatedGap } from "../model/cockpit-view-model";
import { SourceTag } from "./SourceTag";

/**
 * One receipt value, rendered as what it is.
 *
 * An `unavailable` field shows the stated reason, not an empty cell and not a
 * dash — a judge acts differently on "the catalog does not expose this" than on
 * "nobody looked", and a blank tells them neither. A `placeholder` field says so
 * on its face; it can only reach here in a placeholder build, because the view
 * model refuses one anywhere else.
 */
function Evidence({ value }: { value: EvidenceValue }) {
  if (value.state === "unavailable") {
    return <span className="evidence evidence--unavailable">Unavailable — {value.reason}</span>;
  }
  if (value.state === "placeholder") {
    return <span className="evidence evidence--placeholder">{value.value} <em>(placeholder, not observed)</em></span>;
  }
  return <span className="evidence">{value.value} <SourceTag source={value.source} /></span>;
}

const provenanceRows = [
  ["subjectRepository", "Subject repository"],
  ["subjectRevision", "Subject revision"],
  ["artifactRepository", "Artifact repository"],
  ["artifactRevision", "Artifact revision"],
  ["producerVersion", "Artifact producer"],
  ["algorithmVersion", "Algorithm version"],
  ["inputDigest", "Input digest"],
  ["artifactDigest", "Artifact digest"],
  ["dataHubReadParameters", "DataHub read parameters"],
  ["producerPath", "Producer path"],
  ["immutableSourceUrl", "Immutable source URL"],
  ["limitations", "Limitations"],
] as const;

const GAP_SYSTEM: Record<StatedGap["source"], string> = {
  datahub: "DataHub",
  workspacejson: "workspace.json",
  joined: "Joined",
};

/**
 * Everything the event could not establish, banded and placed first.
 *
 * These were distributed through a twelve-row provenance grid at the same visual
 * weight as "Subject repository", which reads as noise. They are the opposite of
 * noise: a stated absence with a named cause is the claim no competing surface
 * makes, and it is the reason this receipt can be trusted about the rows that
 * *are* filled in.
 *
 * Each row names the system that could not supply the field, because "the
 * catalog does not expose this" and "the artifact could not resolve it" are
 * different findings with different fixes.
 */
function UnestablishedBand({ statedGaps }: { statedGaps: readonly StatedGap[] }) {
  return (
    <section aria-labelledby="unestablished-title">
      <p className="eyebrow">What is not established</p>
      <h2 id="unestablished-title">Absence is stated, never omitted</h2>
      {statedGaps.length === 0
        ? <p>The event states no gaps. Every field this receipt carries was observed.</p>
        : (
          <ul className="gap-band">
            {statedGaps.map((gap) => (
              <li className="gap" key={gap.field}>
                <span className="gap__system">{GAP_SYSTEM[gap.source]}</span>
                <span className="gap__field mono">{gap.field}</span>
                <span className="gap__reason">{gap.reason}</span>
                <span className="gap__detail">{gap.detail}</span>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

export function ReceiptsView({ model }: { model: CockpitViewModel }) {
  const { accounting, unresolvedDatasets, statedGaps, provenance, writeback, evaluation } = model.receipt;
  const rawEvidenceBound = evaluation.rawEvidence.state === "observed";
  return <div className="receipts-view">
    <UnestablishedBand statedGaps={statedGaps} />

    <section aria-labelledby="evidence-title">
      <p className="eyebrow">Evidence standing</p>
      <h2 id="evidence-title">The tier is a count, not a warrant</h2>
      {/*
        The tier lives here rather than in the first frame. Rendered as the hero
        it read as a verdict over the whole screen, all-caps and directly above
        "Completeness not established", so the two most prominent statements on
        the page appeared to contradict each other and resolving them meant
        reading a qualifying clause. Its actual meaning is narrow and countable,
        and it belongs beside the records it counts.
      */}
      <p className="evidence-standing">{model.summary}</p>
    </section>

    <section aria-labelledby="accounting-title">
      <p className="eyebrow">Resolution accounting</p>
      <h2 id="accounting-title">Resolution remains bounded by the pinned manifest</h2>
      {/*
        Two denominators, two tables. Datasets are what the catalog was asked
        for; dbt nodes are what the manifest held. Summing them into one total
        was the previous shape, and it is arithmetic no real event can satisfy.
      */}
      <table className="accounting-table">
        <caption>Datasets asked of the catalog. Resolved + unresolved reconciles to requested; no count alone implies completeness.</caption>
        <thead><tr><th>Requested</th><th>Resolved</th><th>Unresolved</th></tr></thead>
        <tbody><tr>
          <td>{accounting.datasetsRequested}</td>
          <td>{accounting.datasetsResolved}</td>
          <td>{accounting.datasetsUnresolved}</td>
        </tr></tbody>
      </table>
      <table className="accounting-table">
        <caption>dbt nodes in the manifest — a separate denominator, never added to the dataset counts.</caption>
        <thead><tr><th>Dropped</th><th>Excluded by policy</th></tr></thead>
        <tbody><tr>
          <td>{accounting.nodesDropped}</td>
          <td>{Object.keys(accounting.nodesExcluded).length === 0
            ? "none recorded"
            : Object.entries(accounting.nodesExcluded).map(([kind, n]) => `${kind}: ${n}`).join(", ")}</td>
        </tr></tbody>
      </table>
      <section aria-labelledby="unresolved-title">
        <h3 id="unresolved-title">Unresolved datasets ({accounting.datasetsUnresolved})</h3>
        {unresolvedDatasets.state === "observed"
          ? (unresolvedDatasets.records.length === 0
            ? <p>None. The empty list is the complete list — every requested dataset resolved.</p>
            : (
              <ul className="unresolved-list">
                {unresolvedDatasets.records.map((record) => (
                  <li key={record.urn}>
                    <code>{record.urn}</code>
                    {/* The reason sits beside the name rather than behind a
                        tooltip: a name alone does not establish scope, which is
                        the whole reason the record carries one. */}
                    <span className="unresolved-list__reason"> — {record.reason}</span>
                  </li>
                ))}
              </ul>
            ))
          : <p className="evidence evidence--unavailable">Unavailable — {unresolvedDatasets.reason}</p>}
      </section>
    </section>

    <section aria-labelledby="provenance-title">
      <p className="eyebrow">Provenance</p>
      <h2 id="provenance-title">Source and epistemic state are separate</h2>
      <p>Read: {model.read} · Completeness: {model.completeness === "complete-against-pinned-manifest" ? "Complete against pinned manifest" : "Not established"} · Resolution: {model.resolutionDisposition}</p>
      <dl className="provenance-list">{provenanceRows.map(([key, label]) =>
        <div key={key}><dt>{label}</dt><dd><Evidence value={provenance[key]} /></dd></div>)}</dl>
      {/*
        No anchor unless there is a commit-pinned URL to anchor to. A link built
        from a branch, or from nothing, is a claim the event does not support.
      */}
      {provenance.immutableSourceUrl.state === "observed"
        ? <a className="view-source" href={provenance.immutableSourceUrl.value} target="_blank" rel="noreferrer">View immutable source</a>
        : <p className="view-source view-source--unavailable">No immutable source link is offered — see the Immutable source URL row for the reason.</p>}
    </section>

    <section aria-labelledby="writeback-title">
      <p className="eyebrow">Writeback proof</p>
      <h2 id="writeback-title">Terminal disposition is not inferred</h2>
      <dl className="provenance-list">
        <div><dt>Intent</dt><dd><Evidence value={writeback.intent} /></dd></div>
        <div><dt>Before-state read</dt><dd><Evidence value={writeback.beforeState} /></dd></div>
        <div><dt>Mutation response</dt><dd>{writeback.mutationResponse}</dd></div>
        <div><dt>After-state read</dt><dd>{writeback.afterStateRead} · {writeback.afterStateFreshness}</dd></div>
        <div><dt>Both states read</dt><dd>{writeback.bothStatesRead ? "yes" : "no"}</dd></div>
        <div><dt>Intended-state observation</dt><dd>{writeback.intendedStateObservation}</dd></div>
        <div><dt>Terminal disposition</dt><dd>{writeback.terminalDisposition}</dd></div>
      </dl>
      {writeback.terminalDisposition === "accepted-not-observed" &&
        <p role="note">The mutation was accepted. That is not success: the intended state was not observed afterwards.</p>}
    </section>

    <section aria-labelledby="disclosure-title">
      <p className="eyebrow">Evaluation and disclosure</p>
      <h2 id="disclosure-title">Limitations lead</h2>
      <p><Evidence value={evaluation.limitations} /></p>
      <dl className="provenance-list">
        <div><dt>Paired evaluation spread</dt><dd><Evidence value={evaluation.pairedSpread} /></dd></div>
        <div><dt>LOC baseline</dt><dd><Evidence value={evaluation.locBaseline} /></dd></div>
      </dl>
      <details>
        <summary>Raw evidence receipt</summary>
        {evaluation.rawEvidence.state === "observed"
          ? <pre>{evaluation.rawEvidence.value}</pre>
          : <p><Evidence value={evaluation.rawEvidence} /></p>}
        {/*
          The controls stay disabled while the raw evidence is not an
          observation. Copying a placeholder off a judge-facing surface is how
          an invented value escapes the one module allowed to hold it.
        */}
        <button type="button" disabled={!rawEvidenceBound}>
          {rawEvidenceBound ? "Copy raw receipt" : "Copy raw receipt (no observed evidence to copy)"}
        </button>
        <button type="button" disabled={!rawEvidenceBound}>
          {rawEvidenceBound ? "Download receipt" : "Download receipt (no observed evidence to download)"}
        </button>
      </details>
    </section>
  </div>;
}
