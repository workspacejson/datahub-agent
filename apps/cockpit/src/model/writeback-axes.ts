/**
 * The writeback's four independent axes, derived from the receipt.
 *
 * These were hardcoded to `not-attempted` with a note that HAC-219 owned them.
 * HAC-219 has landed and the receipt is real, so a judge-facing surface that
 * still says "nothing was attempted" beside a receipt showing a completed
 * mutation is now stating something false. HAC-226 binds the rendering; this
 * supplies the values it binds, so the fixtures proving the terminal states are
 * reachable rather than inert.
 *
 * Why the shape is re-declared here rather than imported: the frozen contract
 * admits `writeback` as `z.unknown().optional()` on purpose — "the shape is
 * owned by the writeback module, so it is admitted by name and not by shape".
 * The cockpit reads the contract, not the implementation, so it narrows the
 * unknown to exactly the fields it renders and refuses the rest. A receipt that
 * grows a field does not become unreadable here, and this cannot quietly start
 * depending on an implementation detail.
 *
 * The axes stay independent because collapsing them is the defect the receipt
 * exists to prevent. Acceptance is not success; a read completing is not the
 * intended state being observed; and a noop is neither a failure nor a change.
 * Four fields, four questions, no field answering two of them.
 */

import { z } from "zod";

import type {
  EvidenceValue,
  IntendedStateObservation,
  MutationAcceptance,
  TerminalWritebackDisposition,
} from "./cockpit-view-model";

/**
 * Only what the cockpit renders. `passthrough` is deliberate: unknown keys are
 * ignored rather than rejected, because this is a read of someone else's
 * artifact, not the contract gate. The contract gate is `emittedEventSchema`.
 */
const stateSchema = z
  .object({
    linkUrl: z.string().nullable().optional(),
    evidenceTier: z.string().nullable().optional(),
    read: z.enum(["ok", "failed", "not-queried"]).optional(),
    readError: z.string().nullable().optional(),
  })
  .passthrough();

const receiptSchema = z
  .object({
    intended: stateSchema.optional(),
    before: stateSchema.nullable().optional(),
    after: stateSchema.nullable().optional(),
    attempts: z
      .array(z.object({ succeeded: z.boolean() }).passthrough())
      .optional(),
    observation: z
      .object({ status: z.enum(["settled", "timed-out", "failed"]) })
      .passthrough()
      .nullable()
      .optional(),
    succeeded: z.boolean().optional(),
    noop: z.boolean().optional(),
    bothStatesRead: z.boolean().optional(),
  })
  .passthrough();

const observed = (value: string): EvidenceValue => ({ state: "observed", value, source: "DataHub" });
const missing = (reason: string): EvidenceValue => ({ state: "unavailable", reason });

export interface WritebackAxes {
  mutationAcceptance: MutationAcceptance;
  intendedStateObservation: IntendedStateObservation;
  terminalWritebackDisposition: TerminalWritebackDisposition;
  /** The receipt block, bound from the same read so the two cannot disagree. */
  receipt: {
    intent: EvidenceValue;
    beforeState: EvidenceValue;
    mutationResponse: MutationAcceptance;
    afterStateRead: "ok" | "failed" | "not-queried";
    bothStatesRead: boolean;
    afterStateFreshness: "fresh" | "stale" | "not-read";
    intendedStateObservation: IntendedStateObservation;
    terminalDisposition: TerminalWritebackDisposition;
  };
  /** Stated when the axes could not be derived, so the gap is never silent. */
  indeterminateBecause: string | null;
}

/**
 * Built from one derivation rather than two.
 *
 * The view model requires the top-level axes to equal the receipt's, and that
 * invariant caught a change that updated only one of them. Producing both from
 * a single read means they cannot drift apart in the first place — the
 * invariant stays as the check, not as the mechanism.
 */
function axes(
  mutationAcceptance: MutationAcceptance,
  intendedStateObservation: IntendedStateObservation,
  terminalWritebackDisposition: TerminalWritebackDisposition,
  receipt: Omit<WritebackAxes["receipt"], "mutationResponse" | "intendedStateObservation" | "terminalDisposition">,
  indeterminateBecause: string | null = null,
): WritebackAxes {
  return {
    mutationAcceptance,
    intendedStateObservation,
    terminalWritebackDisposition,
    receipt: { ...receipt, mutationResponse: mutationAcceptance, intendedStateObservation, terminalDisposition: terminalWritebackDisposition },
    indeterminateBecause,
  };
}

const NOT_ATTEMPTED = axes("not-attempted", "not-attempted", "not-applicable", {
  intent: missing("No writeback receipt is attached to this event, so no intent was recorded."),
  beforeState: missing("No writeback was attempted, so no before-state was read."),
  afterStateRead: "not-queried",
  bothStatesRead: false,
  afterStateFreshness: "not-read",
});

export function writebackAxes(writeback: unknown): WritebackAxes {
  // No writeback is not a failed writeback. Nothing was attempted, and the
  // terminal question does not arise.
  if (writeback === undefined || writeback === null) return NOT_ATTEMPTED;

  const parsed = receiptSchema.safeParse(writeback);
  if (!parsed.success) {
    // A receipt that cannot be read is not an absent one, and reporting it as
    // `not-attempted` would claim knowledge of something unreadable.
    const unreadable = "A writeback receipt is attached but does not carry the fields this view reads, so no terminal state can be stated.";
    return axes("not-attempted", "not-attempted", "indeterminate", {
      intent: missing(unreadable),
      beforeState: missing(unreadable),
      afterStateRead: "not-queried",
      bothStatesRead: false,
      afterStateFreshness: "not-read",
    }, unreadable);
  }

  const receipt = parsed.data;
  const attempts = receipt.attempts ?? [];

  const mutationAcceptance: MutationAcceptance =
    attempts.length === 0 ? "not-attempted" : attempts.every((a) => a.succeeded) ? "accepted" : "rejected";

  // `settled` is the only status meaning the after-state was seen carrying
  // intent. `timed-out` read successfully and showed the wrong thing, which is
  // not-observed — the distinction HAC-223 exists to draw.
  const status = receipt.observation?.status;
  const intendedStateObservation: IntendedStateObservation =
    status === undefined ? "not-attempted" : status === "settled" ? "observed" : "not-observed";

  const terminal = terminalDisposition({
    mutationAcceptance,
    intendedStateObservation,
    noop: receipt.noop ?? false,
    succeeded: receipt.succeeded ?? false,
  });

  const afterStateRead = receipt.after?.read ?? "not-queried";

  return axes(mutationAcceptance, intendedStateObservation, terminal, {
    intent: describeState(receipt.intended, "No intended state was recorded on the receipt."),
    beforeState: describeState(receipt.before, "The before-state was not read, so there is nothing to compare the after-state against."),
    afterStateRead,
    bothStatesRead: receipt.bothStatesRead ?? false,
    // Freshness answers "does the after-state show intent", which is a different
    // question from "did the read complete". A read that succeeded and returned
    // the old value is `ok` and `stale` at once, and collapsing the two would
    // lose exactly the distinction the observation vocabulary exists to draw.
    afterStateFreshness: afterStateRead !== "ok" ? "not-read" : intendedStateObservation === "observed" ? "fresh" : "stale",
  });
}

/** Render a recorded state, or say why there is none. Never both, never neither. */
function describeState(state: z.infer<typeof stateSchema> | null | undefined, absent: string): EvidenceValue {
  if (!state) return missing(absent);
  const tier = state.evidenceTier ?? "no evidence tier";
  const link = state.linkUrl ?? "no link";
  if (state.read === "failed") return missing(`The state read failed: ${state.readError ?? "no error was recorded"}.`);
  if (state.read === "not-queried") return missing("The state was not queried.");
  return observed(`${tier}, ${link}`);
}

function terminalDisposition(input: {
  mutationAcceptance: MutationAcceptance;
  intendedStateObservation: IntendedStateObservation;
  noop: boolean;
  succeeded: boolean;
}): TerminalWritebackDisposition {
  // A noop is its own outcome. Reporting it as success would claim a change
  // that did not happen; reporting it as failure would claim a fault that did
  // not occur. The catalog already held the intended values.
  if (input.noop) return "noop";
  if (input.mutationAcceptance === "rejected") return "failed";
  if (input.mutationAcceptance === "not-attempted") return "not-applicable";

  // The mandatory terminal state. The mutation was accepted and the intended
  // state was not seen — acceptance is not success, and a surface that showed
  // only the acknowledgement would be reporting a write it cannot demonstrate.
  if (input.intendedStateObservation !== "observed") return "accepted-not-observed";

  // `succeeded` is the producer's own conjunction of every mutation succeeding
  // *and* the after-state carrying intent. If it disagrees with the axes derived
  // here, the receipt contradicts itself and neither answer is reported as fact.
  return input.succeeded ? "success" : "contradictory";
}
