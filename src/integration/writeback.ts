/**
 * OSS-safe enrichment writeback, and the receipt it produces.
 *
 * What gets written, and why this and nothing else:
 *
 *   A labelled link from the dataset to the file that produces it, pinned to an
 *   immutable commit.
 *
 * That is the seam this project exists to close, and it is the one enrichment
 * that survives every constraint at once. It is a fact the catalog can verify
 * by following the URL, not a number we invented. It uses `upsertLink`, which
 * is core OSS and inherently idempotent. It appears in the DataHub UI where a
 * reviewer already looks for context. And it never touches human-authored
 * fields.
 *
 * Deliberately NOT written:
 *
 *   - Any risk or fragility score. There is no defensible per-file measurement
 *     available, and publishing one into a catalog other people trust would be
 *     the least honest thing this project could do.
 *   - `description` / `editableProperties`. Those carry human text. A tool that
 *     overwrites them destroys evidence it did not create.
 *   - Anything under a `manual.*` path in the workspace.json artifact. Same
 *     reason, in the other direction.
 *
 * The evidence tier travels as a structured property rather than being folded
 * into the link label, so a consumer reads a typed value instead of parsing
 * prose.
 */

import type { ChangeImpactEvent, EvidenceTier } from "./change-impact-event.js";

/** Stable identifier for the property this tool owns. */
export const EVIDENCE_TIER_PROPERTY_ID = "workspacejson_evidence_tier";

export interface WritebackTarget {
  gmsUrl: string;
  /** Present only when the instance requires it; quickstart does not. */
  token?: string | undefined;
}

export interface MutationAttempt {
  /** The GraphQL mutation invoked, by name. */
  mutation: string;
  /** Variables sent, with any token redacted before it reaches a receipt. */
  variables: Record<string, unknown>;
  succeeded: boolean;
  /** Raw response or error text, truncated. Recorded either way. */
  response: string;
}

/**
 * A receipt is emitted whether or not the write succeeded. A writeback that
 * fails silently is worse than one that fails loudly, and a reviewer needs to
 * see the failure as readily as the success.
 */
export interface WritebackReceipt {
  targetUrn: string;
  actor: { tool: string; version: string };
  attemptedAt: string;
  /** Revision the enrichment was derived from. */
  revision: { repository: string | null; commit: string | null };
  before: { linkUrl: string | null; evidenceTier: EvidenceTier | null };
  after: { linkUrl: string | null; evidenceTier: EvidenceTier | null };
  attempts: MutationAttempt[];
  /** True only when every attempt succeeded. */
  succeeded: boolean;
  /** Set when the write was skipped because the state already matched. */
  noop: boolean;
  /** Why the writeback did not proceed, when it did not. */
  refusedBecause: string | null;
}

export const LINK_LABEL = "Producing source (workspace.json)" as const;

/**
 * Decide whether an event carries enough to enrich from.
 *
 * Returns a refusal reason rather than a boolean, so the receipt can say what
 * was missing instead of reporting a bare failure.
 */
export function refusalReason(event: ChangeImpactEvent): string | null {
  if (event.code.method === "unresolved") {
    return "the producing file could not be resolved, so there is no link to write";
  }
  if (!event.code.sourceUrl) {
    return "no commit-pinned source URL is available; an unpinned link would drift from the artifact it describes";
  }
  if (!event.provenance.corpus.commit) {
    return "the source revision is unknown, so the enrichment could not be attributed to a commit";
  }
  return null;
}

/**
 * Build the exact mutations a writeback would issue, without sending them.
 *
 * Separated from execution so the plan is inspectable in a dry run and
 * assertable in a test without a live instance. The cockpit shows this as the
 * "will write" half of the receipt.
 */
export function planWriteback(
  event: ChangeImpactEvent,
): Array<Pick<MutationAttempt, "mutation" | "variables">> {
  const sourceUrl = event.code.sourceUrl;
  if (!sourceUrl) return [];

  return [
    {
      mutation: "upsertLink",
      variables: {
        input: {
          resourceUrn: event.subject.urn,
          linkUrl: sourceUrl,
          label: LINK_LABEL,
        },
      },
    },
    {
      mutation: "upsertStructuredProperties",
      variables: {
        input: {
          assetUrn: event.subject.urn,
          structuredPropertyInputParams: [
            {
              structuredPropertyUrn: `urn:li:structuredProperty:${EVIDENCE_TIER_PROPERTY_ID}`,
              values: [{ stringValue: event.evidence.tier }],
            },
          ],
        },
      },
    },
  ];
}

/** Strip anything that must not appear in a receipt a reviewer can copy. */
export function redact(variables: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(variables)) as Record<string, unknown>;
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (/token|secret|password|authorization/i.test(key)) {
        (node as Record<string, unknown>)[key] = "[redacted]";
      } else {
        walk(value);
      }
    }
  };
  walk(clone);
  return clone;
}

/**
 * Fold the receipt into the event so a single artifact carries the read, the
 * join, the evidence and the write. The cockpit and the golden fixture both
 * consume one shape rather than correlating two.
 */
export interface EnrichedChangeImpactEvent extends ChangeImpactEvent {
  writeback: WritebackReceipt | null;
}

export function attachReceipt(
  event: ChangeImpactEvent,
  receipt: WritebackReceipt | null,
): EnrichedChangeImpactEvent {
  return { ...event, writeback: receipt };
}
