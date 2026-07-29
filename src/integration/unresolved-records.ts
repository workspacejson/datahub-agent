/**
 * Why a dataset went unresolved, in this producer's words.
 *
 * `accounting.unresolvedRecords[].reason` is free text in the contract, and that
 * is deliberate: HAC-267 declined to freeze a taxonomy nobody has observed the
 * distribution of, because inventing an enum to look rigorous is the same error
 * as inventing the names it sits beside.
 *
 * Free in the contract does not mean free in practice. This project has exactly
 * one producer, so the vocabulary can be constrained here — where it costs
 * nothing to change — instead of in the frozen contract, where it would cost a
 * version bump. Consumers get consistent strings today; the option to close the
 * enum later stays open, and becomes mechanical once real runs show which
 * dispositions actually occur.
 *
 * The mapping is total over the non-resolving dispositions and refuses the
 * resolving one. A `reason` assembled ad hoc at the call site would drift into
 * an undocumented set one string at a time, which is how a vocabulary stops
 * being one.
 */

import type { WorkspaceIntegrity } from "./change-impact-event.js";

/**
 * The disposition that means the join succeeded. It has no unresolved reason,
 * and asking for one is a caller bug rather than a missing entry.
 */
const RESOLVING = "exact-match" as const satisfies WorkspaceIntegrity;

/**
 * Every reason this producer may emit, keyed by the corpus-match disposition
 * that causes it.
 *
 * Each states *why the dataset fell outside the candidate set*, not merely that
 * it did — HAC-217's gate asks for scope establishment, and "unresolved" alone
 * does not distinguish an absent artifact from an ambiguous path. The two have
 * different fixes and a reader who cannot tell them apart cannot act.
 */
export const UNRESOLVED_REASONS: Readonly<Record<Exclude<WorkspaceIntegrity, typeof RESOLVING>, string>> = {
  "artifact-unavailable":
    "No workspace.json artifact was supplied, so no repository-relative path could be looked up for this dataset.",
  "repository-mismatch":
    "The workspace.json artifact describes a different repository than the subject, so its file index cannot answer for this dataset.",
  "revision-mismatch":
    "The workspace.json artifact describes a different revision of the subject repository, so any path it returned would not be revision-bound.",
  "path-unresolved":
    "The artifact matched the subject repository and revision, but its file index contains no entry for this dataset's producing file.",
  "path-ambiguous":
    "The artifact matched the subject, but more than one file-index entry could be this dataset's producing file, and the join refuses to pick between them.",
};

/**
 * The reason string for a disposition that did not resolve.
 *
 * Throws on `exact-match` rather than returning a placeholder: a resolved
 * dataset appearing in `unresolvedRecords` would make the list disagree with
 * `datasetsUnresolved`, which the contract rejects — but it would be rejected
 * one layer too late to say anything useful about where the bug is.
 */
export function unresolvedReasonFor(integrity: WorkspaceIntegrity): string {
  if (integrity === RESOLVING) {
    throw new Error(`${RESOLVING} resolved; it has no unresolved reason and does not belong in unresolvedRecords`);
  }
  return UNRESOLVED_REASONS[integrity];
}

/**
 * The `unresolvedRecords` entry for a subject this producer could not resolve.
 *
 * Returns an empty list when the dataset resolved, so a caller can spread the
 * result unconditionally and cannot accidentally attach a record to a resolved
 * event.
 */
export function unresolvedRecordsFor(
  urn: string,
  integrity: WorkspaceIntegrity,
): Array<{ urn: string; reason: string }> {
  return integrity === RESOLVING ? [] : [{ urn, reason: unresolvedReasonFor(integrity) }];
}
