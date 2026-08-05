import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { provisionalStateAdapter } from "../data/cockpit-adapter";
import { projectEvent } from "../model/from-change-impact-event";
import { contractEvent } from "../test/contract-event";
import { ReceiptsView } from "./ReceiptsView";

afterEach(cleanup);

/** A projected real event, in the mode a fixture build would render it. */
function projected() {
  return { ...projectEvent(contractEvent(), "receipts"), sourceMode: "committed" as const };
}

/** No jest-dom in this project, so the DOM property is read directly. */
function disabled(name: RegExp): boolean {
  return (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
}

it("renders a constructed immutable source URL from corpus provenance, not as a blank", () => {
  // The receipt and the Impact view must agree. When `code.sourceUrl` is null
  // (the MCP read path), the receipt now carries the same constructed
  // commit-pinned link the Impact view shows, tagged `workspace.json`.
  render(<ReceiptsView model={projected()} />);
  const row = screen.getByText("Immutable source URL").closest("div");
  expect(row?.textContent).not.toContain("Unavailable");
  expect(row?.textContent).not.toContain("externalUrl");
});

it("links the immutable source from corpus provenance when the catalog did not expose one", () => {
  render(<ReceiptsView model={projected()} />);
  // The constructed link is present, not absent.
  const link = screen.getByRole("link", { name: "View immutable source" });
  expect(link).toBeTruthy();
  // The URL is commit-pinned, built from corpus provenance.
  const event = contractEvent();
  expect(link.getAttribute("href")).toBe(
    `${event.provenance.corpus.repository}/blob/${event.provenance.corpus.commit}/dbt/models/curated/game_events.sql`,
  );
});

it("links the immutable source when, and only when, the event observed one", () => {
  const event = contractEvent();
  event.code = { ...event.code, sourceUrl: "https://github.com/example/repo/blob/abc123/models/x.sql" };
  render(<ReceiptsView model={{ ...projectEvent(event, "receipts"), sourceMode: "committed" }} />);
  expect(screen.getByRole("link", { name: "View immutable source" }).getAttribute("href"))
    .toBe("https://github.com/example/repo/blob/abc123/models/x.sql");
});

it("keeps the dataset and dbt-node denominators in separate tables", () => {
  // The mixed-vocabulary defect, at the surface: one row summing datasets and
  // nodes would read as a single accounting that reconciles, and it does not.
  render(<ReceiptsView model={projected()} />);
  const [datasets, nodes] = screen.getAllByRole("table");
  expect(datasets.textContent).toContain("Requested");
  expect(datasets.textContent).not.toContain("Dropped");
  expect(nodes.textContent).toContain("Dropped");
  expect(nodes.textContent).not.toContain("Requested");
});

it("marks a placeholder value as unobserved on its face", () => {
  render(<ReceiptsView model={provisionalStateAdapter("partial").read()} />);
  expect(screen.getAllByText(/placeholder, not observed/).length).toBeGreaterThan(0);
});

it("disables copy and download while the raw evidence is not an observation", () => {
  // Copying a placeholder off a judge-facing surface is how an invented value
  // escapes the one module allowed to hold it.
  render(<ReceiptsView model={provisionalStateAdapter("partial").read()} />);
  expect(disabled(/copy raw receipt/i)).toBe(true);
  expect(disabled(/download receipt/i)).toBe(true);
});

it("enables them once the raw evidence is the event itself", () => {
  render(<ReceiptsView model={projected()} />);
  expect(disabled(/copy raw receipt/i)).toBe(false);
  expect(disabled(/download receipt/i)).toBe(false);
});

it("does not present an accepted mutation as success", () => {
  const model = provisionalStateAdapter("accepted-not-observed").read();
  render(<ReceiptsView model={model} />);
  expect(screen.getByRole("note").textContent).toContain("That is not success");
  expect(screen.getByText("Terminal disposition").closest("div")?.textContent)
    .toContain("accepted-not-observed");
});

it("does not let an empty unresolved list read as a finding when names are unavailable", () => {
  const event = contractEvent();
  event.accounting = { ...event.accounting, datasetsRequested: 3, datasetsResolved: 1, datasetsUnresolved: 2 };
  render(<ReceiptsView model={{ ...projectEvent(event, "receipts"), sourceMode: "committed" }} />);
  expect(screen.getByRole("heading", { name: /Unresolved datasets \(2\)/ })).toBeTruthy();
  expect(screen.getByText(/without per-dataset names/)).toBeTruthy();
});

it("renders each unresolved dataset with the reason it did not resolve", () => {
  // A name without a reason says a dataset failed without saying whether the
  // manifest lacked it or the path was ambiguous — different fixes. HAC-217's
  // gate asks for scope, so the reason has to be on screen, not in a title
  // attribute.
  const event = contractEvent();
  event.accounting = {
    ...event.accounting,
    datasetsRequested: 3,
    datasetsResolved: 1,
    datasetsUnresolved: 2,
    unresolvedRecords: [
      { urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.a,PROD)", reason: "no producing node in the pinned manifest" },
      { urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.b,PROD)", reason: "two candidate paths matched; the join refused to pick" },
    ],
  };
  render(<ReceiptsView model={{ ...projectEvent(event, "receipts"), sourceMode: "committed" }} />);

  // Scoped to the section deliberately. The view also renders the whole event
  // as raw JSON for copy/download, so an unscoped text match finds every reason
  // twice — once where a reader reads it, once inside the evidence dump. Asking
  // the document would pass on the dump alone, which is not the claim.
  const section = within(screen.getByRole("region", { name: /Unresolved datasets \(2\)/ }));
  expect(section.getByText("urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.a,PROD)")).toBeTruthy();
  expect(section.getByText(/no producing node in the pinned manifest/)).toBeTruthy();
  expect(section.getByText("urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.b,PROD)")).toBeTruthy();
  expect(section.getByText(/the join refused to pick/)).toBeTruthy();
  // The fallback message must not also be on screen — one state at a time.
  expect(section.queryByText(/without per-dataset names/)).toBeNull();
});

it("renders provenance rows with identifier metadata as proof indicators with semantic labels", () => {
  // The semantic label replaces the raw identifier in the primary reading plane.
  // A judge sees "Exact-source evidence corpus" rather than a naked SHA.
  render(<ReceiptsView model={projected()} />);
  // The subject revision row should carry the semantic label in a proof indicator
  const subjectRevRow = screen.getByText("Subject revision").closest("div");
  expect(subjectRevRow?.textContent).toContain("Exact-source evidence corpus");
  // The artifact revision row should carry its semantic label
  const artifactRevRow = screen.getByText("Artifact revision").closest("div");
  expect(artifactRevRow?.textContent).toContain("Generated-plan evidence revision");
});

it("keeps the raw SHA out of the summary element in provenance rows", () => {
  // Hidden <details> content remains in the DOM, so the test checks the
  // <summary> element specifically — not the full row textContent.
  render(<ReceiptsView model={projected()} />);
  const subjectRevRow = screen.getByText("Subject revision").closest("div");
  const summary = subjectRevRow?.querySelector("summary");
  // The summary should contain the semantic label, not the raw SHA value.
  // The contract event's corpus commit should not appear in the summary text.
  expect(summary?.textContent).toContain("Exact-source evidence corpus");
  // The raw SHA from the contract event should not be in the summary
  const event = contractEvent();
  const commit = event.provenance.corpus.commit;
  if (commit) {
    expect(summary?.textContent).not.toContain(commit);
  }
});

it("renders provenance rows without identifier metadata as before", () => {
  // The producer version row does not carry identifier metadata, so it should
  // render as a plain evidence value, not a proof indicator.
  render(<ReceiptsView model={projected()} />);
  const producerRow = screen.getByText("Artifact producer").closest("div");
  // No proof indicator summary should be present in this row
  expect(producerRow?.querySelector("summary.proof-indicator__summary")).toBeNull();
});

/**
 * A 1.3 event, whose verification block cannot say whether its parameters
 * describe the manifest or the read.
 */
function legacyProjected() {
  const event = contractEvent();
  event.eventVersion = "1.3";
  event.datahub.lineageObservation.upstreams = {
    read: "ok",
    completeness: "complete-against-pinned-manifest",
    observedCount: event.datahub.upstreams.length,
    verification: {
      manifestDigest: "m",
      expectedSetDigest: "e",
      observedSetDigest: "e",
      queryParameters: { surface: "searchAcrossLineage", direction: "UPSTREAM", maxDegree: 4 },
    },
  };
  return { ...projectEvent(event, "receipts"), sourceMode: "committed" as const };
}

it("badges 1.3 parameters as legacy, never as declared", () => {
  // The view model can be neutral and the screen can still classify. This
  // asserts the rendered output, because the badge is what a judge reads and it
  // was contradicting the note beside it.
  render(<ReceiptsView model={legacyProjected()} />);
  const row = screen.getByText("Legacy query parameters").closest("div");
  expect(row?.textContent).toContain("Legacy");
  expect(row?.textContent).toContain("Role unknown");
  expect(row?.textContent).not.toContain("Declared");
});

it("leaves the declared row unavailable on a 1.3 receipt, rather than filling it", () => {
  render(<ReceiptsView model={legacyProjected()} />);
  const row = screen.getByText("Declared query parameters").closest("div");
  expect(row?.textContent).toContain("Unavailable");
  expect(row?.textContent).not.toContain("maxDegree");
});

it("attributes no executed read on a 1.3 receipt", () => {
  render(<ReceiptsView model={legacyProjected()} />);
  const row = screen.getByText("Executed query parameters").closest("div");
  expect(row?.textContent).toContain("Unavailable");
  expect(row?.textContent).toContain("contract 1.3");
});
