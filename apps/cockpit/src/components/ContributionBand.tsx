import type { CockpitViewModel } from "../model/cockpit-view-model";
import { revisionLabel } from "./format";

/**
 * Who contributed what, as three responsibilities rather than three names.
 *
 * This band is what the six-cell status strip became. That strip stated six
 * derived values with no actor attached to any of them, so a reader could see
 * that lineage was 8/1 and that a writeback was observed without ever learning
 * which system had supplied which. The cells here are verb-led and read left to
 * right as the actor model: DataHub supplied, workspace.json supplied, tally
 * did.
 *
 * Every data line is derived from the model and guarded on its own state. None
 * of them prints a count, a prefix or a revision the model does not carry: an
 * invented value in the band that exists to say who supplied what would be the
 * one lie this surface cannot afford.
 */

const READ_LABEL: Record<CockpitViewModel["read"], string> = {
  ok: "returned",
  failed: "failed",
  "not-queried": "was never made",
};

/** The terminal writeback dispositions, in the vocabulary the contract uses. */
const WRITEBACK_LABEL: Record<CockpitViewModel["receipt"]["writeback"]["terminalDisposition"], string> = {
  "not-applicable": "not attempted",
  success: "observed in DataHub on reread",
  "accepted-not-observed": "accepted, not observed",
  failed: "failed",
  noop: "already in the intended state",
  indeterminate: "indeterminate",
  contradictory: "contradictory",
};

function lineageLine(model: CockpitViewModel): string {
  if (model.read !== "ok") return `The lineage read ${READ_LABEL[model.read]}.`;
  const upstream = model.impactEdges.filter((edge) => edge.direction === "upstream").length;
  const downstream = model.impactEdges.filter((edge) => edge.direction === "downstream").length;
  return `${upstream} upstream, ${downstream} downstream declared edges`;
}

/**
 * The prefix and the revision, in one line, or whichever of the two exists.
 *
 * The prefix is the segment DataHub never exposes and the revision is what pins
 * it, so together they are exactly what the artifact adds. Falling back to the
 * producer path's own text keeps the cell honest when the artifact resolved
 * nothing: the path slot then carries the stated non-resolution rather than a
 * blank.
 */
function repositoryLine(model: CockpitViewModel): string {
  const prefix = model.projectPrefix;
  const revision = revisionLabel(model.receipt.provenance.subjectRevision);
  if (prefix && revision) return `the missing ${prefix}/ prefix, read at ${revision}`;
  if (prefix) return `the missing ${prefix}/ prefix`;
  if (revision) return `read at ${revision}`;
  return model.producerPath.text;
}

export function ContributionBand({ model }: { model: CockpitViewModel }) {
  const cells = [
    {
      key: "datahub",
      badge: "DataHub supplied",
      role: "Dataset identity and declared lineage.",
      value: lineageLine(model),
    },
    {
      key: "workspacejson",
      badge: "workspace.json supplied",
      role: "The repository file and the revision it is bound to.",
      value: repositoryLine(model),
    },
    {
      /*
        "Compared the plans, and recorded a writeback" rather than "wrote one
        property back". The sentence has to stay true for every terminal
        disposition the contract allows, and `not-applicable` is one of them, so
        a cell that asserts a write happened would be wrong on a model that
        states none. The disposition itself carries what happened.
      */
      key: "tally",
      badge: "tally did",
      role: "Joined the two coordinate systems and compared the plans.",
      value: `Writeback ${WRITEBACK_LABEL[model.receipt.writeback.terminalDisposition]}`,
    },
  ] as const;

  return (
    <section className="contribution-band" aria-label="What each system contributed">
      {cells.map(({ key, badge, role, value }) => (
        <article className={`contribution contribution--${key}`} key={key}>
          <p className={`contribution__badge contribution__badge--${key}`}>{badge}</p>
          <p className="contribution__role">{role}</p>
          <p className="contribution__value">{value}</p>
        </article>
      ))}
    </section>
  );
}
