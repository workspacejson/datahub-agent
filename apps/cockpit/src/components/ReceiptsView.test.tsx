import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { provisionalStateAdapter } from "../data/cockpit-adapter";
import { projectEvent } from "../model/from-change-impact-event";
import { contractEvent } from "../test/contract-event";
import { ReceiptsView } from "./ReceiptsView";

afterEach(cleanup);

/** A projected real event, in the mode a fixture build would render it. */
function projected() {
  return { ...projectEvent(contractEvent(), "receipts"), sourceMode: "fixture" as const };
}

/** No jest-dom in this project, so the DOM property is read directly. */
function disabled(name: RegExp): boolean {
  return (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
}

it("renders an unavailable receipt field as a stated reason, never as a blank", () => {
  // A blank cell tells a judge nothing. "The catalog does not expose this" and
  // "nobody looked" are different findings and they act on them differently.
  render(<ReceiptsView model={projected()} />);
  const row = screen.getByText("Immutable source URL").closest("div");
  expect(row?.textContent).toContain("Unavailable —");
  expect(row?.textContent).toContain("externalUrl");
});

it("offers no immutable source link when the event carries no commit-pinned URL", () => {
  render(<ReceiptsView model={projected()} />);
  expect(screen.queryByRole("link", { name: "View immutable source" })).toBeNull();
  expect(screen.getByText(/No immutable source link is offered/)).toBeTruthy();
});

it("links the immutable source when, and only when, the event observed one", () => {
  const event = contractEvent();
  event.code = { ...event.code, sourceUrl: "https://github.com/example/repo/blob/abc123/models/x.sql" };
  render(<ReceiptsView model={{ ...projectEvent(event, "receipts"), sourceMode: "fixture" }} />);
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
  render(<ReceiptsView model={{ ...projectEvent(event, "receipts"), sourceMode: "fixture" }} />);
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
  render(<ReceiptsView model={{ ...projectEvent(event, "receipts"), sourceMode: "fixture" }} />);

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
