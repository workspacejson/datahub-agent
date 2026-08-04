import { useState } from "react";
import { Check, ExternalLink, Eye } from "lucide-react";
import { GAP_SOURCE_LABEL } from "../model/cockpit-view-model";
import type { CockpitViewModel, EvidenceValue, StatedGap } from "../model/cockpit-view-model";
import { Icon } from "./Icon";
import { ProofIndicator } from "./ProofIndicator";
import { SourceTag } from "./SourceTag";
import { TermDefinition } from "./TermDefinition";

declare const __COCKPIT_RECEIPT_HTML__: string | null;

/**
 * One receipt value, rendered as what it is.
 *
 * An `unavailable` field shows the stated reason, not an empty cell and not a
 * dash. A judge acts differently on "the catalog does not expose this" than on
 * "nobody looked", and a blank tells them neither. A `placeholder` field says so
 * on its face; it can only reach here in a placeholder build, because the view
 * model refuses one anywhere else.
 */
function Evidence({ value }: { value: EvidenceValue }) {
  if (value.state === "unavailable") {
    // Amber marks the state, not the sentence. Six lines of amber 12px mono read
    // as an error for what is a legitimate, deliberately stated absence, and it
    // put the caution colour and the absence colour on the same treatment so the
    // two meanings collided. The tag carries the amber; the explanation is sans
    // at body size in muted grey, which is also the fastest text to read.
    return (
      <span className="evidence evidence--unavailable">
        <span className="evidence__tag">Unavailable</span>
        <span className="evidence__reason">{value.reason}</span>
      </span>
    );
  }
  if (value.state === "placeholder") {
    return <span className="evidence evidence--placeholder">{value.value} <em>(placeholder, not observed)</em></span>;
  }
  if (value.identifier) {
    return (
      <span className="evidence">
        <ProofIndicator
          variant="block"
          label={value.identifier.semanticLabel}
          value={value.value}
          identifierType={value.identifier.type}
          copyLabel={value.identifier.copyLabel ?? "Copy"}
          openUrl={value.identifier.openUrl}
        />
        <SourceTag source={value.source} />
      </span>
    );
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
  // `limitations` is deliberately absent. It is the source-capability limits
  // joined into one string, which is the same content as the gap band at the top
  // of this receipt, minus the per-row source the band adds. Rendering both put
  // the same two reasons on the page twice, at the weight of any other row.
] as const;

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
                <span className="gap__system">{GAP_SOURCE_LABEL[gap.source]}</span>
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

export function ReceiptsView({ model, datasetKey }: { model: CockpitViewModel; datasetKey?: string }) {
  const { accounting, unresolvedDatasets, statedGaps, provenance, writeback, evaluation } = model.receipt;
  const rawEvidenceBound = evaluation.rawEvidence.state === "observed";
  const [exportNote, setExportNote] = useState<string | null>(null);

  /**
   * The exact bytes on screen, or null when there is nothing observed to export.
   *
   * Read through the same discriminant the buttons disable on, so "enabled" and
   * "has something to export" cannot drift apart.
   */
  const exportable = evaluation.rawEvidence.state === "observed" ? evaluation.rawEvidence.value : null;

  /**
   * A filename a judge can still identify a week later, derived from the dataset
   * the receipt is about rather than a constant, because a reviewer comparing two
   * runs ends up with two files in one directory.
   */
  const filename = `tally-receipt-${model.datasetIdentity.text.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "receipt"}.json`;

  const copyReceipt = async (): Promise<void> => {
    if (exportable === null) return;
    try {
      await navigator.clipboard.writeText(exportable);
      setExportNote("Raw receipt copied to the clipboard.");
    } catch {
      // Not a silent failure: the clipboard needs a secure context and a
      // permission, and a judge who believes they copied a receipt they did not
      // is worse off than one who is told it failed.
      setExportNote("The browser refused clipboard access, so nothing was copied. Use Download receipt, or select the text above.");
    }
  };

  const downloadReceipt = (): void => {
    if (exportable === null) return;
    const url = URL.createObjectURL(new Blob([exportable], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    setExportNote(`Receipt downloaded as ${filename}.`);
  };

  return <div className="receipts-view">
    <p className="route-intro">How to trust this: every claim has a source, every absence has a reason.</p>
    <UnestablishedBand statedGaps={statedGaps} />

    <section aria-labelledby="evidence-title">
      <p className="eyebrow"><TermDefinition term="Evidence standing" definition="A tier is a label derived from how many checks ran and what they observed. It is not a verdict on whether the change is safe." /></p>
      <h2 id="evidence-title">The tier is a count, not a warrant</h2>
      {/*
        The tier lives here rather than in the first frame. Rendered as the hero
        it read as a verdict over the whole screen, all-caps and directly above
        "Completeness not established", so the two most prominent statements on
        the page appeared to contradict each other and resolving them meant
        reading a qualifying clause. Its actual meaning is narrow and countable,
        and it belongs beside the records it counts.
      */}
      <p className="evidence-standing">
        {(() => {
          const sep = model.summary.indexOf(": ");
          if (sep === -1) return <span>{model.summary}</span>;
          const tier = model.summary.slice(0, sep);
          const rest = model.summary.slice(sep + 2);
          return (
            <>
              <span className="evidence-tier-badge" aria-label="Evidence tier">{tier}</span>
              {rest}
            </>
          );
        })()}
      </p>
      <p className="proof-ledger-gloss">A proof ledger is the full chain of evidence: every claim above is tied to a verification command in the raw receipt below.</p>
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
        <caption>dbt nodes in the manifest. A separate denominator, never added to the dataset counts.</caption>
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
            ? <p>None. The empty list is the complete list: every requested dataset resolved.</p>
            : (
              <ul className="unresolved-list">
                {unresolvedDatasets.records.map((record) => (
                  <li key={record.urn}>
                    <code>{record.urn}</code>
                    {/* The reason sits beside the name rather than behind a
                        tooltip: a name alone does not establish scope, which is
                        the whole reason the record carries one. */}
                    <span className="unresolved-list__reason">{record.reason}</span>
                  </li>
                ))}
              </ul>
            ))
          : <p className="evidence evidence--unavailable">
              <span className="evidence__tag">Unavailable</span>
              <span className="evidence__reason">{unresolvedDatasets.reason}</span>
            </p>}
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
        ? <a className="view-source" href={provenance.immutableSourceUrl.value} target="_blank" rel="noreferrer">View immutable source <Icon icon={ExternalLink} className="semantic-icon" /></a>
        : <p className="view-source view-source--unavailable">No immutable source link is offered. The Immutable source URL row states why.</p>}
    </section>

    <section aria-labelledby="writeback-title">
      <p className="eyebrow">Writeback proof</p>
      <h2 id="writeback-title">Terminal disposition is not inferred</h2>
      <dl className="provenance-list">
        <div><dt>Intent</dt><dd><Evidence value={writeback.intent} /></dd></div>
        <div><dt>Before-state read</dt><dd><Evidence value={writeback.beforeState} /></dd></div>
        <div className="writeback-state writeback-state--accepted">
          <dt><Icon icon={Check} className="semantic-icon" /> <span>Mutation response</span></dt>
          <dd>{writeback.mutationResponse}</dd>
        </div>
        <div className="writeback-state writeback-state--observed">
          <dt><Icon icon={Eye} className="semantic-icon" /> <span>After-state read</span></dt>
          <dd>{writeback.afterStateRead} · {writeback.afterStateFreshness}</dd>
        </div>
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
      {/*
        They lead literally: every stated gap opens this receipt, each naming the
        system that could not supply it. `evaluation.limitations` restated the
        gap count and the tier sentence that "The tier is a count, not a warrant"
        already carries, so rendering it here put the same sentence on the page
        twice, reordered. The value is still in the raw receipt below.
      */}
      <p>Stated in full at the top of this receipt, each with the system that could not supply it.</p>
      <dl className="provenance-list">
        <div><dt>LOC baseline</dt><dd><Evidence value={evaluation.locBaseline} /></dd></div>
      </dl>
      <details>
        <summary>Raw evidence receipt</summary>
        {evaluation.rawEvidence.state === "observed"
          ? (typeof __COCKPIT_RECEIPT_HTML__ === "string" && __COCKPIT_RECEIPT_HTML__ && datasetKey === "nested"
            ? <div className="shiki-receipt" dangerouslySetInnerHTML={{ __html: __COCKPIT_RECEIPT_HTML__ }} />
            : <pre>{evaluation.rawEvidence.value}</pre>)
          : <p><Evidence value={evaluation.rawEvidence} /></p>}
        {/*
          The controls stay disabled while the raw evidence is not an
          observation. Copying a placeholder off a judge-facing surface is how
          an invented value escapes the one module allowed to hold it.

          They also *do* something, which they did not until HAC-287. Both
          rendered enabled whenever evidence was bound and carried no handler at
          all, so the one affordance this product offers for taking the evidence
          away and checking it did nothing. Receipt export is the whole thesis:
          a judge who cannot leave with the receipt has to take our word for it.

          Both export `rawEvidence.value` verbatim, which is the same string the
          `pre` above renders. Re-serialising here would let the file and the
          screen disagree, and the file is the artifact someone checks later.
        */}
        <button type="button" disabled={!rawEvidenceBound} onClick={copyReceipt}>
          {rawEvidenceBound ? "Copy raw receipt" : "Copy raw receipt (no observed evidence to copy)"}
        </button>
        <button type="button" disabled={!rawEvidenceBound} onClick={downloadReceipt}>
          {rawEvidenceBound ? "Download receipt" : "Download receipt (no observed evidence to download)"}
        </button>
        {/*
          An export that silently fails is the defect this replaced, in a smaller
          form. The clipboard needs a secure context and a permission, so it can
          refuse; when it does, say so rather than leaving the button looking like
          it worked.
        */}
        {exportNote !== null && <p role="status" className="export-note">{exportNote}</p>}
      </details>
    </section>
  </div>;
}
