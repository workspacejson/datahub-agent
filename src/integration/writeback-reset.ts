/**
 * Undo, for exactly the metadata this tool writes and nothing else.
 *
 * Why a reset command exists at all:
 *
 * The writeback is idempotent, which makes it safe to repeat and useless as a
 * demonstration the second time. A judge who runs it once sees `succeeded`; a
 * judge who runs it again sees `noop`, which is the correct answer and not the
 * one that shows the tool working. Without a way back to the starting state, the
 * only reproducible demonstration is against a freshly nuked DataHub — minutes
 * of container startup to re-prove one mutation.
 *
 * Why it is written as an allowlist rather than a cleanup:
 *
 * A reset that reasons about what to delete is a reset that can delete something
 * it did not write. This one cannot express that operation. It removes a link at
 * one exact URL under one exact label, and one structured property under one
 * exact id — all three of which this tool defines as constants. There is no
 * pattern, no prefix match, and no "everything on this entity" path, because the
 * catalog is shared with metadata nobody here authored.
 *
 * In particular it never touches `description`, `editableProperties`, tags,
 * terms, ownership or domain. Those carry human text or human decisions, and the
 * writeback declines to write them for the same reason this declines to remove
 * them.
 *
 * Why it verifies afterwards:
 *
 * A mutation returning cleanly is not evidence the state is gone — the same
 * index-convergence lag that makes the writeback poll its after-state applies in
 * reverse. A reset that reported success on an accepted mutation would hand back
 * a "clean" instance that still serves the old link for the next several seconds,
 * and the very next writeback would then observe a `noop` it had no business
 * observing. So the owned state is read back and the reset claims nothing until
 * that read shows it absent.
 */

import { EVIDENCE_TIER_PROPERTY_ID, LINK_LABEL, type ReadStatus } from "./writeback.js";

/** The full set of metadata this tool claims ownership of on a dataset. */
export interface OwnedState {
  /** The URL of the link this tool wrote, or null when it holds none. */
  linkUrl: string | null;
  /** The evidence tier this tool wrote, or null when it holds none. */
  evidenceTier: string | null;
  read: ReadStatus;
  readError: string | null;
}

/** Whether an observed state still carries anything this tool owns. */
export function ownsAnything(state: OwnedState): boolean {
  return state.linkUrl !== null || state.evidenceTier !== null;
}

export interface ResetMutation {
  mutation: string;
  variables: Record<string, unknown>;
}

/**
 * The exact mutations that would clear the owned state, given what is there.
 *
 * Derived from the observed state rather than issued unconditionally, so a reset
 * against an already-clean instance issues nothing and says so — rather than
 * sending removals that "succeed" against absent metadata and make an empty
 * instance look like one that was just cleaned.
 *
 * `removeLink` needs the URL it is removing, which is why the before-state is a
 * parameter and not an afterthought: there is no "remove the link you wrote"
 * mutation, only "remove this URL".
 */
export function planReset(urn: string, state: OwnedState): ResetMutation[] {
  const plan: ResetMutation[] = [];

  if (state.linkUrl !== null) {
    plan.push({
      mutation: "removeLink",
      // The label is sent as well as the URL. DataHub matches on the pair, and
      // sending only the URL would remove a link somebody else happened to
      // record at the same address under their own label.
      variables: { input: { resourceUrn: urn, linkUrl: state.linkUrl, label: LINK_LABEL } },
    });
  }

  if (state.evidenceTier !== null) {
    plan.push({
      mutation: "removeStructuredProperties",
      variables: {
        input: {
          assetUrn: urn,
          structuredPropertyUrns: [`urn:li:structuredProperty:${EVIDENCE_TIER_PROPERTY_ID}`],
        },
      },
    });
  }

  return plan;
}

/**
 * What the reset established, in the same shape of vocabulary the receipt uses.
 *
 *   cleared        owned state was present, was removed, and was read back absent
 *   already-clean  nothing owned was present to begin with
 *   incomplete     mutations were accepted but the state was still observed present
 *   failed         a mutation failed, or the verifying read did not complete
 *
 * `already-clean` and `cleared` are kept apart for the reason the whole contract
 * keeps `not-queried` apart from `absent`: only one of them is evidence that the
 * removal path works, and a demonstration that conflates them proves nothing.
 *
 * `incomplete` is not folded into `failed`. A mutation the catalog accepted
 * while the read still shows the old value is index lag, not a rejected write,
 * and the operator's next move differs: wait and re-verify, versus investigate.
 */
export type ResetDisposition = "cleared" | "already-clean" | "incomplete" | "failed";

export interface ResetOutcomeInput {
  before: OwnedState;
  after: OwnedState;
  attempts: Array<{ succeeded: boolean }>;
}

export function deriveResetDisposition({ before, after, attempts }: ResetOutcomeInput): ResetDisposition {
  // A before-state nobody could read cannot support any claim about what was
  // cleared, including the claim that there was nothing to clear.
  if (before.read !== "ok") return "failed";
  if (!ownsAnything(before)) return "already-clean";
  if (attempts.some((attempt) => !attempt.succeeded)) return "failed";
  if (after.read !== "ok") return "failed";
  return ownsAnything(after) ? "incomplete" : "cleared";
}

export interface ResetReceipt {
  targetUrn: string;
  actor: { tool: string; version: string };
  attemptedAt: string;
  /** Exactly what this command is permitted to remove, stated in the receipt itself. */
  owns: { linkLabel: string; structuredPropertyId: string };
  before: OwnedState;
  after: OwnedState;
  attempts: Array<{ mutation: string; variables: Record<string, unknown>; succeeded: boolean; response: string }>;
  /** How the after-state was reached, mirroring the writeback receipt's field. */
  observation: { polls: number; elapsedMs: number; timeoutMs: number } | null;
  disposition: ResetDisposition;
}

/** The ownership statement every reset receipt carries, so the boundary is inspectable. */
export function ownershipStatement(): ResetReceipt["owns"] {
  return { linkLabel: LINK_LABEL, structuredPropertyId: EVIDENCE_TIER_PROPERTY_ID };
}
