import type { CockpitViewModel, ImpactEdge, ViewSource } from "../model/cockpit-view-model";
import { SourceTag } from "./SourceTag";

/**
 * The link, and never without its origin.
 *
 * A constructed link is labelled constructed and shows the three inputs it was
 * built from. Presenting it bare would let a reader take it for something the
 * catalog asserted, which is the collapse this surface exists to refuse: the
 * link is just as clickable either way, and only one of the two is honest.
 *
 * It renders inside the producer-file card rather than beneath the card row. It
 * is a link to *that* file, and standing alone between two panels it read as
 * unowned page furniture.
 */
function ViewSourceLink({ viewSource }: { viewSource: ViewSource }) {
  if (viewSource.state === "unavailable") {
    return <p className="view-source view-source--unavailable">View Source unavailable. {viewSource.reason}</p>;
  }
  return (
    <>
      <a className="view-source" href={viewSource.url} target="_blank" rel="noreferrer">View Source</a>
      {viewSource.state === "constructed"
        ? <span className="view-source__origin">(constructed, not catalog-supplied)</span>
        : <span className="view-source__origin">(declared by the catalog)</span>}
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

/**
 * One node in the topology band.
 *
 * Degree is a chip rather than a sentence. Every node in a catalog read carries
 * the same sentence with one number changed, and ten copies of it was most of
 * the Impact screen.
 */
function LineageNode({ edge, showSource }: { edge: ImpactEdge; showSource: boolean }) {
  return (
    <li className="topology__node">
      <span className="topology__name">{edge.node}</span>
      <span className="topology__meta">
        {edge.degree !== null && <span className="chip chip--degree">degree {edge.degree}</span>}
        {/*
          The resolution axis, which this view never rendered at all: `state` was
          in the model and on no screen. It stays a separate chip from the source
          tag, so a DataHub node can read unresolved.
        */}
        {edge.state !== "resolved" && <span className={`chip chip--${edge.state === "unresolved" ? "unresolved" : "not-queried"}`}>{edge.state}</span>}
        {showSource && edge.source !== "unavailable" && <SourceTag source={edge.source} />}
      </span>
    </li>
  );
}

/**
 * Lineage as a topology rather than a list.
 *
 * Ten near-identical cards, each badged with the same source, filled half the
 * primary screen with catalog output and pushed the joined evidence, which is
 * the actual argument, below it. Direction is the information in a lineage read,
 * so direction is the layout: upstream, the subject, downstream.
 *
 * The source tag moves to the band header when every node shares one source, and
 * drops back onto each node when they differ. The rule that every node carries a
 * source exists so a mixed read stays readable; repeating one value ten times
 * distinguishes nothing and costs the space the argument needed.
 */
function TopologyBand({ model }: { model: CockpitViewModel }) {
  const upstream = model.impactEdges.filter((edge) => edge.direction === "upstream");
  const downstream = model.impactEdges.filter((edge) => edge.direction === "downstream");
  const undirected = model.impactEdges.filter((edge) => edge.direction === "none");
  const sources = [...new Set(model.impactEdges.map((edge) => edge.source))];
  const sharedSource = sources.length === 1 && sources[0] !== "unavailable" ? sources[0] : null;

  return (
    <section className="lineage-band" aria-label="Lineage topology">
      <header className="lineage-band__head">
        <div>
          <h2>Lineage read and completeness are separate</h2>
          <p>
            Read: {model.read}. Completeness: {model.completeness}.{" "}
            {undirected.length > 0 && model.completeness !== "complete-against-pinned-manifest"
              ? "No observed edges does not mean no impact."
              : "Observed by the catalog lineage read."}
          </p>
        </div>
        {sharedSource && <SourceTag source={sharedSource} />}
      </header>

      {undirected.length > 0 ? (
        <ul className="topology__nodes">
          {undirected.map((edge) => (
            <li className="topology__node topology__node--stated" key={edge.node}>
              <span className="topology__name">{edge.node}</span>
              <span className="topology__reason">{edge.reason}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="topology">
          <div className="topology__col">
            <p className="eyebrow">Upstream ({upstream.length})</p>
            <ul className="topology__nodes">
              {upstream.map((edge) => <LineageNode edge={edge} showSource={!sharedSource} key={edge.node} />)}
            </ul>
          </div>
          <div className="topology__col topology__col--subject">
            <p className="eyebrow">Under review</p>
            <ul className="topology__nodes">
              <li className="topology__node topology__node--subject">
                <span className="topology__name">{model.title}</span>
              </li>
            </ul>
          </div>
          <div className="topology__col">
            <p className="eyebrow">Downstream ({downstream.length})</p>
            <ul className="topology__nodes">
              {downstream.map((edge) => <LineageNode edge={edge} showSource={!sharedSource} key={edge.node} />)}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * What the join contributes, then what the catalog read.
 *
 * The claim row used to lead with a `Dataset identity` card restating the URN
 * printed a hundred pixels above it in the hero. That spent one of three slots
 * in the row that carries the join on a repetition, and the two cards that
 * actually answer "what does workspace.json add" were crowded into the rest. The
 * URN is in the hero, tagged with its source; the row is now the join alone.
 */
export function ImpactView({ model }: { model: CockpitViewModel }) {
  return (
    <section aria-label="Impact evidence">
      <div className="identity-grid identity-grid--join">
        <article className="claim claim--identifier">
          <p>Producer file</p>
          <strong>{model.producerPath.text}</strong>
          <SourceTag source={model.producerPath.source} />
          <ViewSourceLink viewSource={model.viewSource} />
        </article>
        <article className="claim claim--evidence">
          <p>Repository evidence</p>
          <strong>{model.repositoryEvidence.text}</strong>
          <SourceTag source={model.repositoryEvidence.source} />
        </article>
      </div>

      <TopologyBand model={model} />
    </section>
  );
}
