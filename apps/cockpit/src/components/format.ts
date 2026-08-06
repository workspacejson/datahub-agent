import type { EvidenceValue } from "../model/cockpit-view-model";

/**
 * A 40-character SHA shortened for the interface. Anything else renders whole.
 *
 * Lifted out of `OutcomeBar` when the six-cell strip was cut. More than one
 * surface prints the subject revision now, and they have to agree on its length:
 * the reduction's whole premise is that the revision appears a small, deliberate
 * number of times rather than five times by accident, and two call sites
 * disagreeing about the form would put that back.
 */
export function shortRevision(value: string): string {
  return /^[0-9a-f]{40}$/i.test(value) ? value.slice(0, 8) : value;
}

/**
 * The short form of a revision, or null when the model carries no revision to
 * shorten.
 *
 * Null rather than a dash or an empty string: a caller has to decide what an
 * absent revision means in its own band, and returning a plausible-looking
 * blank would let one of them print a revision slot with nothing in it.
 */
export function revisionLabel(value: EvidenceValue): string | null {
  if (value.state === "observed" || value.state === "placeholder"
    || value.state === "declared" || value.state === "legacy") {
    return shortRevision(value.value);
  }
  return null;
}
