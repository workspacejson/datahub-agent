/**
 * A `JudgeRunBundle` built around a real `ChangeImpactEvent`, digested with the
 * carrier's own `digestEvent`.
 *
 * Shared for the same reason `contract-event.ts` is: a bundle whose digest is
 * computed by the test rather than by the contract would bind to nothing, and
 * would pass while the binding it claims to exercise was broken. Overrides go to
 * the comparison, so a test can break exactly one invariant and leave the rest
 * valid.
 */
import { digestEvent, type PlanComparisonArtifact, type RunIdentity } from "@comparison";
import type { ChangeImpactEvent } from "@contract";

import { contractEvent } from "./contract-event";

export const RUN: RunIdentity = {
  taskId: "add-quality-check",
  promptDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  model: "qwen-plus",
  settingsDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
};

export function comparison(
  event: ChangeImpactEvent,
  over: Partial<PlanComparisonArtifact> = {},
): PlanComparisonArtifact {
  return {
    artifactVersion: "1.0",
    eventDigest: digestEvent(event),
    snapshot: {
      repository: event.provenance.corpus.repository as string,
      revision: event.provenance.corpus.commit as string,
      datahub: { gmsUrl: event.provenance.datahub.gmsUrl, eventProducedAt: event.provenance.producedAt },
    },
    datahubOnlyPlan: { mode: "datahub-only", run: RUN, steps: [{ id: "s1", action: "refuse: the producing file is unknown" }] },
    joinedPlan: { mode: "joined", run: RUN, steps: [{ id: "s2", action: "edit the resolved producing file" }] },
    deltas: [{
      kind: "added",
      label: "use the exact producing source",
      reason: "only the joined context resolves the repository-relative producing file",
      evidenceRefs: ["evidence.records[0]"],
    }],
    ...over,
  };
}

export function judgeRunBundle(event: ChangeImpactEvent = contractEvent(), over: Partial<PlanComparisonArtifact> = {}) {
  return { bundleVersion: "1.0" as const, event, comparison: comparison(event, over) };
}
