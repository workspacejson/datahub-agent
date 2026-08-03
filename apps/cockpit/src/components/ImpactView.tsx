import { motion, stagger, useReducedMotion, type Variants } from "motion/react";
import { GAP_SOURCE_LABEL } from "../model/cockpit-view-model";
import type { CockpitViewModel, ImpactEdge, StatedGap, ViewSource } from "../model/cockpit-view-model";
import { SourceTag } from "./SourceTag";
import { TermDefinition } from "./TermDefinition";

/** The contract field the seam is about: the producing file's repository-relative path. */
const PRODUCER_PATH_FIELD = "code.repositoryRelativePath";

/**
 * The link, and never without its origin.
 *
 * A constructed link is labelled constructed and shows the three inputs it was
 * built from. Presenting it bare would let a reader take it for something the
 * catalog asserted, which is the collapse this surface exists to refuse: the
 * link is just as clickable either way, and only one of the two is honest.
 */
function ViewSourceLink({ viewSource }: { viewSource: ViewSource }) {
  if (viewSource.state === "unavailable") {
    return <p className="view-source view-source--unavailable">View Source unavailable. {viewSource.reason}</p>;
  }
  return (
    <>
      <a className="view-source" href={viewSource.url} target="_blank" rel="noreferrer">View source at this revision</a>
      {viewSource.state === "constructed"
        ? <span className="view-source__origin">constructed, not catalog-supplied</span>
        : <span className="view-source__origin">declared by the catalog</span>}
      <details>
        <summary>How this link was built</summary>
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
 * The seam: what the catalog could not supply, directly above what the join did.
 *
 * This is the product's entire argument, and it was previously only assertable
 * by reading three separate cards and inferring the relationship between them.
 * Both halves are recorded facts, not framing: the event states the gap on
 * `unavailable[]` with its source and reason, and states the resolved path on
 * `code`. Putting them in one element in that order exhibits the claim instead
 * of asserting it, and it is the one place on this screen where the two systems
 * are visibly doing different work.
 *
 * If the event states no gap for the producing path, the upper half is omitted
 * rather than invented. A seam with nothing on the catalog side is a dataset the
 * catalog could resolve on its own, and saying otherwise would be a fabricated
 * contrast on the one screen that must not have any.
 */
function ResolutionSeam({ model, gap }: { model: CockpitViewModel; gap: StatedGap | undefined }) {
  return (
    <article className="seam" aria-label="Producing file resolution">
      <p className="eyebrow">Producing file</p>

      {gap && (
        <div className="seam__row seam__row--withheld">
          <span className="seam__system">{GAP_SOURCE_LABEL[gap.source]}</span>
          <span className="seam__value">
            <span className="seam__field mono">{gap.field}</span>
            <span className="seam__reason">{gap.detail}</span>
          </span>
        </div>
      )}

      <div className="seam__row seam__row--resolved">
        <span className="seam__system">
          <SourceTag source={model.producerPath.source} />
        </span>
        <span className="seam__value">
          <strong className="seam__path mono">{model.producerPath.text}</strong>
          <ViewSourceLink viewSource={model.viewSource} />
        </span>
      </div>
    </article>
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
        {/*
          The platform, because without it this column reads as untidy rather
          than structured: four dbt models beside the four duckdb datasets they
          are built from, half the names bare and half fully qualified. The
          distinction is load-bearing and was invisible, so the only inference a
          cold reader could draw was that the list had not been cleaned up.
        */}
        {edge.platform && <span className="chip chip--platform">{edge.platform}</span>}
        {edge.degree !== null && <span className="chip chip--degree">{edge.degree}</span>}
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
  // Grouped by platform, then by degree. This only reorders on recorded fields:
  // it does not assert that a dbt model and a duckdb dataset sharing a name are
  // the same object, which the event does not state. It just stops the two
  // layers from interleaving into what looks like an unsorted list.
  const byPlatformThenDegree = (a: ImpactEdge, b: ImpactEdge) =>
    (a.platform ?? "").localeCompare(b.platform ?? "") || (a.degree ?? 0) - (b.degree ?? 0);
  const upstream = model.impactEdges.filter((edge) => edge.direction === "upstream").sort(byPlatformThenDegree);
  const downstream = model.impactEdges.filter((edge) => edge.direction === "downstream").sort(byPlatformThenDegree);
  const undirected = model.impactEdges.filter((edge) => edge.direction === "none");
  const sources = [...new Set(model.impactEdges.map((edge) => edge.source))];
  const sharedSource = sources.length === 1 && sources[0] !== "unavailable" ? sources[0] : null;

  return (
    <section className="lineage-band" aria-label="Lineage topology">
      <header className="lineage-band__head">
        <div>
          <p className="eyebrow"><TermDefinition term="Declared lineage" definition="The datasets DataHub records as feeding this one or depending on it, as declared to the catalog." /></p>
          {/*
            The head stays; the sentence under it moved to the coverage band in
            the hero. It is the answer to "can I trust the set in front of me",
            which is the question a reviewer opens this screen with, and stating
            it here as well made the same fact appear twice on one page.
          */}
          <h2>Lineage read and completeness are separate</h2>
        </div>
        <div className="lineage-band__key">
          {/* The badges were bare integers with no key anywhere on the page. */}
          <span className="lineage-band__legend">platform · lineage degree</span>
          {sharedSource && <SourceTag source={sharedSource} />}
        </div>
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

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

const containerVariants: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      when: "beforeChildren",
      delayChildren: stagger(0.15, { startDelay: 0.2 }),
    },
  },
};

/**
 * The join first, the catalog second.
 *
 * Order is the argument. This screen exists to show that joining repository
 * evidence resolves what the catalog alone cannot, and it previously opened with
 * three small cards of preamble followed by a wall of catalog output, so a cold
 * reader's first seconds landed on the half that is not the product.
 */
export function ImpactView({ model }: { model: CockpitViewModel }) {
  const producerGap = model.receipt.statedGaps.find((gap) => gap.field === PRODUCER_PATH_FIELD);
  const reduce = useReducedMotion();

  return (
    <motion.section
      aria-label="Impact evidence"
      initial={reduce ? false : "hidden"}
      animate="visible"
      variants={reduce ? undefined : containerVariants}
    >
      {/*
        The mechanism, then this dataset's instance of it. They are not the same
        statement: the first says why joining two coordinate systems can return
        nothing at all, the second says what that did here. The spec's lead card
        makes both points in that order for the same reason.
      */}
      <p className="hero__stakes">DataHub says where data flows; git says what breaks together; <TermDefinition term="joining them" definition="Matching the dbt-project-relative path DataHub records against the repository-relative path Git uses. The two coordinate systems name the same file differently." /> silently returns nothing. Here is the proof.</p>
      <p className="route-intro">What broke: the catalog cannot resolve this dataset to a file.</p>
      <ResolutionSeam model={model} gap={producerGap} />

      <motion.article className="claim claim--evidence" variants={reduce ? undefined : itemVariants}>
        <p className="eyebrow">Repository evidence</p>
        <strong>{model.repositoryEvidence.text}</strong>
        <SourceTag source={model.repositoryEvidence.source} />
      </motion.article>

      <motion.div variants={reduce ? undefined : itemVariants}>
        <TopologyBand model={model} />
      </motion.div>
    </motion.section>
  );
}
