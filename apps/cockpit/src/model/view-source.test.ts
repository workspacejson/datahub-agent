import { describe, expect, it } from "vitest";

import { contractEvent } from "../test/contract-event";

import { resolveViewSource } from "./view-source";

describe("resolving the View Source link", () => {
  it("uses the catalog's URL when the catalog has one", () => {
    const event = contractEvent();
    event.code.sourceUrl = "https://example.com/declared.sql";
    expect(resolveViewSource(event)).toEqual({ state: "declared", url: "https://example.com/declared.sql" });
  });

  it("constructs a commit-pinned URL from provenance the event already records", () => {
    const event = contractEvent();
    const resolved = resolveViewSource(event);
    expect(resolved.state).toBe("constructed");
    if (resolved.state !== "constructed") return;
    expect(resolved.url).toBe(
      `${event.provenance.corpus.repository}/blob/${event.provenance.corpus.commit}/dbt/models/curated/game_events.sql`,
    );
  });

  it("pins the constructed URL to the commit, not to a branch", () => {
    // A branch-relative link drifts the moment the branch moves, which makes it
    // worse than no link: it keeps resolving, to the wrong thing.
    const event = contractEvent();
    const resolved = resolveViewSource(event);
    if (resolved.state !== "constructed") throw new Error("expected a constructed link");
    expect(resolved.url).toContain(`/blob/${event.provenance.corpus.commit}/`);
    expect(resolved.url).not.toMatch(/\/blob\/(main|master|HEAD)\//);
  });

  it("carries the inputs so the construction can be checked rather than trusted", () => {
    const event = contractEvent();
    const resolved = resolveViewSource(event);
    if (resolved.state !== "constructed") throw new Error("expected a constructed link");
    expect(resolved.from).toEqual({
      repository: event.provenance.corpus.repository,
      revision: event.provenance.corpus.commit,
      path: "dbt/models/curated/game_events.sql",
    });
  });

  it("normalizes a remote that carries .git or a trailing slash", () => {
    const event = contractEvent();
    event.provenance.corpus.repository = "https://github.com/dcaribou/transfermarkt-datasets.git";
    const resolved = resolveViewSource(event);
    if (resolved.state !== "constructed") throw new Error("expected a constructed link");
    expect(resolved.url).toContain("transfermarkt-datasets/blob/");
    expect(resolved.url).not.toContain(".git/blob");
  });

  it("names which input was missing rather than reporting one undifferentiated absence", () => {
    // "Cannot link" is not one fact. An unresolved producing file and an
    // unpinned corpus have different fixes, and a reader told only that the
    // link is missing cannot tell which one they are looking at.
    const event = contractEvent();
    event.code.repositoryRelativePath = null;
    const resolved = resolveViewSource(event);
    expect(resolved.state).toBe("unavailable");
    if (resolved.state !== "unavailable") return;
    expect(resolved.reason).toContain("repository-relative path");
    expect(resolved.reason).not.toContain("corpus commit");
  });

  it("refuses to guess the blob-path shape of a host it does not know", () => {
    // A guessed path resolves elsewhere or nowhere. Either is a fabricated
    // claim wearing a working link's clothes.
    const event = contractEvent();
    event.provenance.corpus.repository = "https://git.example.internal/team/repo";
    const resolved = resolveViewSource(event);
    expect(resolved.state).toBe("unavailable");
    if (resolved.state !== "unavailable") return;
    expect(resolved.reason).toContain("not a host");
  });

  it("never returns a link it did not build from recorded fields", () => {
    // The whole point: every URL this can emit is either the catalog's own or a
    // function of three fields in the event. There is no third path.
    const event = contractEvent();
    const resolved = resolveViewSource(event);
    if (resolved.state === "unavailable") throw new Error("expected a link");
    const inputs = [
      event.provenance.corpus.repository,
      event.provenance.corpus.commit,
      event.code.repositoryRelativePath,
    ];
    for (const input of inputs) expect(resolved.url).toContain(String(input));
  });
});
