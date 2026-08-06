import { motion, stagger, useReducedMotion, type Variants } from "motion/react";
import type { CockpitViewModel, ImpactEdge, ViewSource } from "../model/cockpit-view-model";
import { SourceTag } from "./SourceTag";
import { TermDefinition } from "./TermDefinition";

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
/**
 * The same file named by two coordinate systems, with the difference visible.
 *
 * The join fails on one missing segment, and a reader comparing two long paths
 * character by character will not find it. Rendering the prefix as its own slot
 * makes the difference structural: one row has the segment, the other has a hole
 * where it would go.
 *
 * The hole is empty. The canvas fills it with `dbt/?`, which reads as DataHub
 * offering a guess it does not have -- the prefix is exactly what the catalog
 * never exposes, and printing it on the catalog row attributes it to the wrong
 * system on the one screen whose whole argument is which system supplied what.
 * The slot carries a question mark and its explanation instead, and the prefix
 * appears once, on the row that actually supplies it.
 */
function CoordinateSeam({ model }: { model: CockpitViewModel }) {
  if (!model.dbtFilePath || !model.projectPrefix) return null;
  const prefix = model.projectPrefix.endsWith("/") ? model.projectPrefix : `${model.projectPrefix}/`;
  return (
    <div className="coordinates" aria-label="The same file in two coordinate systems">
      <div className="coordinate coordinate--open">
        <span className="coordinate__system">DataHub coordinate</span>
        <span className="coordinate__path mono">
          <span className="coordinate__slot" title="Repository prefix, not exposed by DataHub">?</span>
          {model.dbtFilePath}
        </span>
      </div>
      <div className="coordinate coordinate--resolved">
        <span className="coordinate__system">Repository coordinate</span>
        <span className="coordinate__path mono">
          <span className="coordinate__prefix">{prefix}</span>{model.dbtFilePath}
        </span>
      </div>
    </div>
  );
}

/**
 * The producing file, and the commit-pinned way to open it.
 *
 * The withheld row is gone from here, not from the frame. It stated the catalog
 * gap with its cause, which is now the `Why` line of the plan delta above the
 * fold, where it is the reason the plan changed rather than a preamble to a path.
 * Rendering it in both places put one recorded reason on one route twice, which
 * is the duplication this pass exists to remove.
 *
 * What is left is the thing that exists nowhere else: the link, and never without
 * its origin. The path stays as the link's subject at body weight; the display
 * setting of it belongs to the subject band, which now carries it.
 */
function ResolutionSeam({ model }: { model: CockpitViewModel }) {
  return (
    <article className="seam" aria-label="Producing file resolution">
      <p className="eyebrow">Producing file</p>

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
          The degree badge carries its unit. A bare integer beside a dataset name
          reads as a count of anything -- rows, columns, incidents -- and the one
          thing it is, a distance in the graph, was the one reading unavailable.
          The direction is the column heading, so the badge does not repeat it.
        */}
        {edge.degree !== null && (
          <span className="chip chip--degree">{edge.degree} hop{edge.degree === 1 ? "" : "s"}</span>
        )}
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
 * The nodes of one direction, grouped under the platform that names them.
 *
 * The dbt and duckdb entries are two coordinate systems for the same models, not
 * duplicate rows, and the platform was previously a chip repeated on every node:
 * eight copies of two values, which is eight badges spent to make one
 * distinction. As a group heading it is stated twice instead of eight times, and
 * the grouping is what makes the two coordinate systems visible as two.
 *
 * Nodes with no platform on their URN fall into a final unlabelled group rather
 * than being assigned one.
 */
function LineageGroups({ edges, showSource }: { edges: ImpactEdge[]; showSource: boolean }) {
  const platforms = [...new Set(edges.map((edge) => edge.platform))];
  return (
    <>
      {platforms.map((platform) => (
        <div className="topology__group" key={platform ?? "unlabelled"}>
          {platform && <p className="topology__platform">{platform}</p>}
          <ul className="topology__nodes">
            {edges.filter((edge) => edge.platform === platform).map((edge) => (
              <LineageNode edge={edge} showSource={showSource} key={edge.node} />
            ))}
          </ul>
        </div>
      ))}
    </>
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
        {/*
          The legend is gone because the badges no longer need one: each carries
          its own unit and each group carries its own platform. A key that repeats
          what every badge already says is one more thing to read.
        */}
        <div className="lineage-band__key">
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
            <LineageGroups edges={upstream} showSource={!sharedSource} />
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
            <LineageGroups edges={downstream} showSource={!sharedSource} />
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
/**
 * The naive join, and what it returned.
 *
 * Moved down from the shell's hero. Above the fold its job was to state the
 * failure before the repair, and the plan delta now does that in the run's own
 * recorded words: refuse to edit, versus edit one named file. This is the
 * mechanism behind that pair, so it opens the disclosed half of the route rather
 * than competing with the decision for the first frame.
 *
 * The path pair it used to print is gone: `CoordinateSeam` below renders the same
 * two spellings as a shape, with the missing segment as a hole rather than as a
 * substring a reader has to diff by eye.
 */
function SilentZeroCallout({ model }: { model: CockpitViewModel }) {
  if (!model.dbtFilePath || !model.projectPrefix) return null;
  return (
    <article className="silent-zero silent-zero--inline" aria-label="Silent zero: naive join failure">
      <p className="silent-zero__result">
        <TermDefinition term="Naive join" definition="A direct path lookup with no prefix normalization: the dbt path is compared to the repository path exactly as each system spells it." />: 0 matches. No error. No warning. Exit code 0.
      </p>
    </article>
  );
}

export function ImpactView({ model }: { model: CockpitViewModel }) {
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
      {/*
        "git says where each file lives", not "what breaks together". The second
        is a co-change claim, and this event's receipt states the opposite on
        `partners`: indeterminate, because the artifact carries no behavioral
        co-change evidence. The hero asserting a capability the receipt disclaims
        is the one contradiction this surface cannot afford, since the receipt is
        the reason to believe anything else on the page. The narrowed clause is
        what the artifact actually supplies: the file's location, which is
        exactly what the join below resolves.
      */}
      {/*
        The stakes sentence keeps its place at the head of the disclosed half and
        loses the `route-intro` line that used to follow it. "What broke: the
        catalog cannot resolve this dataset to a file" was the same statement one
        register plainer, three lines below the sentence that already made it and
        directly above the seam that exhibits it.
      */}
      <p className="hero__stakes">DataHub says where data flows; git says where each file lives; <TermDefinition term="joining them" definition="Matching the dbt-project-relative path DataHub records against the repository-relative path Git uses. The two coordinate systems name the same file differently." /> silently returns nothing. Here is the proof.</p>
      <SilentZeroCallout model={model} />
      <CoordinateSeam model={model} />
      <ResolutionSeam model={model} />

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
