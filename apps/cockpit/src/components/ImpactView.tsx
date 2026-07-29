import type { CockpitViewModel, ViewSource } from "../model/cockpit-view-model";
import { SourceTag } from "./SourceTag";

/**
 * The link, and never without its origin.
 *
 * A constructed link is labelled constructed and shows the three inputs it was
 * built from. Presenting it bare would let a reader take it for something the
 * catalog asserted, which is the collapse this surface exists to refuse — the
 * link is just as clickable either way, and only one of the two is honest.
 */
function ViewSourceLink({ viewSource }: { viewSource: ViewSource }) {
  if (viewSource.state === "unavailable") {
    return <p className="view-source view-source--unavailable">View Source unavailable — {viewSource.reason}</p>;
  }
  return (
    <>
      <a className="view-source" href={viewSource.url} target="_blank" rel="noreferrer">View Source</a>
      {viewSource.state === "constructed"
        ? <span className="view-source__origin"> (constructed, not catalog-supplied)</span>
        : <span className="view-source__origin"> (declared by the catalog)</span>}
      <details>
        <summary>Source URL details</summary>
        <code>{viewSource.url}</code>
        {viewSource.state === "constructed" && (
          <p>
            Constructed from the pinned corpus rather than read from DataHub, whose MCP projection
            drops <code>Dataset.externalUrl</code>. Repository <code>{viewSource.from.repository}</code>,
            revision <code>{viewSource.from.revision}</code>, path <code>{viewSource.from.path}</code>.
          </p>
        )}
      </details>
    </>
  );
}
export function ImpactView({ model, onReviewPlan }: { model: CockpitViewModel; onReviewPlan(): void }) { return <section aria-label="Impact evidence"><div className="identity-grid">{([['Dataset identity', model.datasetIdentity], ['Producer file', model.producerPath], ['Repository evidence', model.repositoryEvidence]] as const).map(([label, claim]) => <article className="claim" key={label}><p>{label}</p><strong>{claim.text}</strong><SourceTag source={claim.source} /></article>)}</div><ViewSourceLink viewSource={model.viewSource} /><section className="impact-rail"><h2>Lineage read and completeness are separate</h2><p>Read: {model.read}. Completeness: {model.completeness}. {model.impactEdges.length === 0 && model.completeness !== "complete-against-pinned-manifest" ? "No observed edges does not mean no impact." : ""}</p><ul>{model.impactEdges.map((edge) => <li key={edge.label}><strong>{edge.label}</strong> — {edge.reason} {edge.source !== "unavailable" && <SourceTag source={edge.source} />}</li>)}</ul></section><button className="cta" type="button" onClick={onReviewPlan}>Review changed plan</button></section>; }
