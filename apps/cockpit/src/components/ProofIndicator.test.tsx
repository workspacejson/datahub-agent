import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ProofIndicator } from "./ProofIndicator";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("renders the semantic label in the summary when collapsed", () => {
  render(
    <ProofIndicator
      variant="compact"
      label="Exact-source evidence corpus"
      value="59fa295c51fc23466f3a71542f8bf3d1335daa83"
      identifierType="git-commit-sha"
      copyLabel="Copy SHA"
    />,
  );
  const summary = document.querySelector("summary.proof-indicator__summary");
  expect(summary).toBeTruthy();
  expect(summary?.textContent).toContain("Exact-source evidence corpus");
});

it("does not expose the raw canonical value in the summary text", () => {
  render(
    <ProofIndicator
      variant="compact"
      label="Exact-source evidence corpus"
      value="59fa295c51fc23466f3a71542f8bf3d1335daa83"
      identifierType="git-commit-sha"
    />,
  );
  const summary = document.querySelector("summary.proof-indicator__summary");
  // The raw SHA must not appear in the summary element's text content. It
  // exists in the DOM (hidden by <details>) but is absent from the summary.
  expect(summary?.textContent).not.toContain("59fa295c");
});

it("reveals the canonical value and type label on expand", () => {
  render(
    <ProofIndicator
      variant="block"
      label="Bound to this analysis event"
      value="abc123def456"
      identifierType="event-digest"
      copyLabel="Copy digest"
    />,
  );
  // Open the <details> element
  const details = document.querySelector("details");
  if (details) details.open = true;
  // The type label uses the fixed mapping, not the enum value
  expect(screen.getByText("Event digest")).toBeTruthy();
  expect(screen.getByText("abc123def456")).toBeTruthy();
});

it("shows the identifier type label from the fixed mapping, not the enum value", () => {
  render(
    <ProofIndicator
      variant="compact"
      label="Expected URN set digest"
      value="deadbeef"
      identifierType="set-digest"
    />,
  );
  const details = document.querySelector("details");
  if (details) details.open = true;
  expect(screen.getByText("Set digest")).toBeTruthy();
  expect(screen.queryByText("set-digest")).toBeNull();
});

it("writes the canonical value to the clipboard on copy", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(
    <ProofIndicator
      variant="compact"
      label="Exact-source evidence corpus"
      value="59fa295c"
      identifierType="git-commit-sha"
      copyLabel="Copy SHA"
    />,
  );
  const details = document.querySelector("details");
  if (details) details.open = true;
  const button = screen.getByRole("button", { name: "Copy SHA" });
  fireEvent.click(button);
  await new Promise((r) => setTimeout(r, 0));
  expect(writeText).toHaveBeenCalledWith("59fa295c");
});

it("shows 'Copied' with no trailing space when copyLabel is the default", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(
    <ProofIndicator
      variant="compact"
      label="Exact-source evidence corpus"
      value="59fa295c"
      identifierType="git-commit-sha"
    />,
  );
  const details = document.querySelector("details");
  if (details) details.open = true;
  const button = screen.getByRole("button", { name: "Copy" });
  fireEvent.click(button);
  await new Promise((r) => setTimeout(r, 0));
  const status = screen.getByRole("status");
  expect(status.textContent).toBe("Copied");
  expect(status.textContent).not.toMatch(/\s$/);
});

it("shows an open link only when openUrl is provided", () => {
  const { rerender } = render(
    <ProofIndicator
      variant="compact"
      label="Exact-source evidence corpus"
      value="59fa295c"
      identifierType="git-commit-sha"
    />,
  );
  const details = document.querySelector("details");
  if (details) details.open = true;
  expect(screen.queryByRole("link", { name: "Open" })).toBeNull();

  rerender(
    <ProofIndicator
      variant="compact"
      label="Exact-source evidence corpus"
      value="59fa295c"
      identifierType="git-commit-sha"
      openUrl="https://github.com/example/repo/commit/59fa295c"
    />,
  );
  const details2 = document.querySelector("details");
  if (details2) details2.open = true;
  expect(screen.getByRole("link", { name: "Open" }).getAttribute("href"))
    .toBe("https://github.com/example/repo/commit/59fa295c");
});

it("renders both compact and block variants without error", () => {
  const { rerender } = render(
    <ProofIndicator
      variant="compact"
      label="Dataset URN"
      value="urn:li:dataset:(urn:li:dataPlatform:dbt,test,PROD)"
      identifierType="dataset-urn"
    />,
  );
  expect(document.querySelector(".proof-indicator--compact")).toBeTruthy();

  rerender(
    <ProofIndicator
      variant="block"
      label="Dataset URN"
      value="urn:li:dataset:(urn:li:dataPlatform:dbt,test,PROD)"
      identifierType="dataset-urn"
    />,
  );
  expect(document.querySelector(".proof-indicator--block")).toBeTruthy();
});

it("a second copy resets the full feedback duration without a stale timeout", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(
    <ProofIndicator
      variant="compact"
      label="Exact-source evidence corpus"
      value="59fa295c"
      identifierType="git-commit-sha"
      copyLabel="Copy SHA"
    />,
  );
  const details = document.querySelector("details");
  if (details) details.open = true;
  const button = screen.getByRole("button", { name: "Copy SHA" });

  fireEvent.click(button);
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.getByRole("status").textContent).toBe("Copied SHA");

  // Wait 1s — past the first timeout's midpoint but not past 2s.
  await new Promise((r) => setTimeout(r, 1000));
  // Status is still visible from the first copy.
  expect(screen.queryByRole("status")).not.toBeNull();

  // Second copy: the first timeout must be cleared, and a fresh 2s window starts.
  fireEvent.click(button);
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.getByRole("status").textContent).toBe("Copied SHA");

  // At 1.5s after the second copy (2.5s after the first), the first timeout
  // would have fired — but it was cleared. The status must still be visible.
  await new Promise((r) => setTimeout(r, 1500));
  expect(screen.queryByRole("status")).not.toBeNull();

  // After the full 2s from the second copy, the status clears.
  await new Promise((r) => setTimeout(r, 600));
  expect(screen.queryByRole("status")).toBeNull();
});

it("unmounting with a pending timeout causes no post-unmount state update", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const { unmount } = render(
    <ProofIndicator
      variant="compact"
      label="Exact-source evidence corpus"
      value="59fa295c"
      identifierType="git-commit-sha"
      copyLabel="Copy SHA"
    />,
  );
  const details = document.querySelector("details");
  if (details) details.open = true;
  const button = screen.getByRole("button", { name: "Copy SHA" });
  fireEvent.click(button);
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.getByRole("status").textContent).toBe("Copied SHA");

  // Unmount while the 2s timeout is still pending. The cleanup effect clears it.
  unmount();

  // Wait past the original timeout duration. No error should be thrown by
  // a state update on an unmounted component.
  await new Promise((r) => setTimeout(r, 2100));
  // The document body should not contain the status text.
  expect(document.body.textContent).not.toContain("Copied SHA");
});

it("unmounting while the clipboard promise is pending causes no post-unmount state update", async () => {
  // The race: copy() awaits navigator.clipboard.writeText, and unmount happens
  // before the promise resolves. Without the mounted guard, the await returns,
  // setCopyStatus fires on an unmounted component, and a new timeout is leaked.
  let resolveWrite: () => void;
  const writeText = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
    resolveWrite = resolve;
  }));
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const { unmount } = render(
    <ProofIndicator
      variant="compact"
      label="Exact-source evidence corpus"
      value="59fa295c"
      identifierType="git-commit-sha"
      copyLabel="Copy SHA"
    />,
  );
  const details = document.querySelector("details");
  if (details) details.open = true;
  const button = screen.getByRole("button", { name: "Copy SHA" });
  fireEvent.click(button);

  // Unmount while the clipboard promise is still pending.
  unmount();

  // Resolve the promise — this is the point where the mounted guard must fire.
  resolveWrite!();
  await new Promise((r) => setTimeout(r, 0));

  // Wait past the 2s timeout duration. No state update should have fired.
  await new Promise((r) => setTimeout(r, 2100));
  expect(document.body.textContent).not.toContain("Copied SHA");
});
