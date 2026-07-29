/**
 * The commit-pinned "View Source" link, and where it came from.
 *
 * HAC-145 required "an immutable View Source URL when resolution succeeds". That
 * was written against the direct-GraphQL read path. HAC-148 moved reads behind
 * the official MCP server, whose `Dataset` projection carries no `externalUrl` —
 * there is no tool to ask — so `code.sourceUrl` is null on every artifact this
 * repository emits (`evaluation/mcp-field-coverage.md`).
 *
 * The link is not evidence. It is a pure function of three fields the event
 * already records: the corpus repository, the pinned commit, and the
 * repository-relative path of the producing file. So it is constructed here, at
 * render time, and labelled as constructed. `code.sourceUrl` keeps saying null,
 * which is true, and the judge still gets a link that cannot drift.
 *
 * Constructing rather than storing is the point. A field holding a pure function
 * of three recorded fields is redundant data in a frozen contract, and adding it
 * would cost a version bump plus a ripple through emitter, validator, adapter,
 * view model, and tests — for a value the receipt already determines. It also
 * degrades on its own: when the MCP projection carries `externalUrl` again
 * (HAC-156), `declared` starts winning with no consumer change and no second
 * field for a reader to arbitrate between. One rule, both eras:
 *
 *   present -> use it, label it declared
 *   absent  -> construct it, label it constructed
 */

import type { ChangeImpactEvent } from "@contract";

export interface ViewSourceDeclared {
  state: "declared";
  url: string;
}

export interface ViewSourceConstructed {
  state: "constructed";
  url: string;
  from: { repository: string; revision: string; path: string };
}

export interface ViewSourceUnavailable {
  state: "unavailable";
  reason: string;
}

export type ViewSource = ViewSourceDeclared | ViewSourceConstructed | ViewSourceUnavailable;

/**
 * Hosts whose commit-pinned blob URL shape this knows.
 *
 * Deliberately a allowlist rather than a pattern. Guessing the path shape for an
 * unrecognised host produces a link that resolves to nothing, or worse to
 * something else — and a broken link presented as a source of truth is the same
 * defect as a fabricated one. An unknown host is stated as unavailable instead.
 */
const BLOB_PATH: ReadonlyArray<{ host: string; segment: string }> = [
  { host: "github.com", segment: "blob" },
  { host: "gitlab.com", segment: "-/blob" },
];

/** Strip the trailing `.git` and any trailing slash a remote URL may carry. */
function normalizeRepository(repository: string): string {
  return repository.replace(/\.git$/, "").replace(/\/+$/, "");
}

export function resolveViewSource(event: ChangeImpactEvent): ViewSource {
  // What the catalog said, when it says anything, always wins.
  if (event.code.sourceUrl) return { state: "declared", url: event.code.sourceUrl };

  const repository = event.provenance.corpus?.repository ?? null;
  const revision = event.provenance.corpus?.commit ?? null;
  const path = event.code.repositoryRelativePath;

  // Each input is named separately, because "cannot link" is not one fact. A
  // reader who is told only that the link is missing cannot tell an unresolved
  // producing file from an unpinned corpus, and those have different fixes.
  const missing = [
    repository ? null : "corpus repository",
    revision ? null : "corpus commit",
    path ? null : "repository-relative path",
  ].filter((name): name is string => name !== null);

  if (missing.length > 0) {
    return {
      state: "unavailable",
      reason:
        `The catalog exposes no commit-pinned URL, and one cannot be constructed: ` +
        `the event records no ${missing.join(", no ")}.`,
    };
  }

  const normalized = normalizeRepository(repository as string);
  const known = BLOB_PATH.find(({ host }) => {
    try {
      return new URL(normalized).host === host;
    } catch {
      return false;
    }
  });

  if (!known) {
    return {
      state: "unavailable",
      reason:
        `The catalog exposes no commit-pinned URL, and ${normalized} is not a host ` +
        `whose blob-path shape is known. Guessing one would produce a link that resolves ` +
        `elsewhere or nowhere, which is no better than fabricating it.`,
    };
  }

  return {
    state: "constructed",
    url: `${normalized}/${known.segment}/${revision as string}/${path as string}`,
    from: { repository: normalized, revision: revision as string, path: path as string },
  };
}
