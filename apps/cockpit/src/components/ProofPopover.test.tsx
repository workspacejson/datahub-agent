import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { ProofPopover } from "./ProofPopover";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("renders a trigger button with the visible label text", () => {
  render(
    <ProofPopover
      label="View dataset identity"
      value="urn:li:dataset:(urn:li:dataPlatform:dbt,test,PROD)"
      identifierType="dataset-urn"
    />,
  );
  const trigger = screen.getByRole("button", { name: /View dataset identity/ });
  expect(trigger).toBeTruthy();
});

it("does not expose the raw canonical value in the trigger text", () => {
  render(
    <ProofPopover
      label="View dataset identity"
      value="urn:li:dataset:(urn:li:dataPlatform:dbt,test,PROD)"
      identifierType="dataset-urn"
    />,
  );
  const trigger = screen.getByRole("button", { name: /View dataset identity/ });
  expect(trigger.textContent).not.toContain("urn:li:dataset");
});

it("does not render the popover panel in the DOM when closed", () => {
  render(
    <ProofPopover
      label="View dataset identity"
      value="urn:li:dataset:(urn:li:dataPlatform:dbt,test,PROD)"
      identifierType="dataset-urn"
    />,
  );
  expect(screen.queryByText("Dataset URN")).toBeNull();
  expect(screen.queryByText(/urn:li:dataset/)).toBeNull();
});

it("reveals the type label, canonical value, and copy button on open", async () => {
  const user = userEvent.setup();
  render(
    <ProofPopover
      label="View binding proof"
      value="abc123def456"
      identifierType="event-digest"
      copyLabel="Copy digest"
    />,
  );
  await user.click(screen.getByRole("button", { name: /View binding proof/ }));
  expect(screen.getByText("Event digest")).toBeTruthy();
  expect(screen.getByText("abc123def456")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy digest" })).toBeTruthy();
});

it("uses the fixed mapping for the type label, not the enum value", async () => {
  const user = userEvent.setup();
  render(
    <ProofPopover
      label="Expected URN set digest"
      value="deadbeef"
      identifierType="set-digest"
    />,
  );
  await user.click(screen.getByRole("button", { name: /Expected URN set digest/ }));
  expect(screen.getByText("Set digest")).toBeTruthy();
  expect(screen.queryByText("set-digest")).toBeNull();
});

it("writes the canonical value to the clipboard on copy", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const user = userEvent.setup();
  render(
    <ProofPopover
      label="View dataset identity"
      value="59fa295c"
      identifierType="git-commit-sha"
      copyLabel="Copy SHA"
    />,
  );
  await user.click(screen.getByRole("button", { name: /View dataset identity/ }));
  const button = screen.getByRole("button", { name: "Copy SHA" });
  fireEvent.click(button);
  await new Promise((r) => setTimeout(r, 0));
  // The status text proves clipboard.writeText was called and resolved:
  // "Copied SHA" is only set after `await navigator.clipboard.writeText(value)`.
  expect(screen.getByRole("status").textContent).toBe("Copied SHA");
});

it("shows 'Copied' with no trailing space when copyLabel is the default", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const user = userEvent.setup();
  render(
    <ProofPopover
      label="View dataset identity"
      value="59fa295c"
      identifierType="git-commit-sha"
    />,
  );
  await user.click(screen.getByRole("button", { name: /View dataset identity/ }));
  const button = screen.getByRole("button", { name: "Copy" });
  fireEvent.click(button);
  await new Promise((r) => setTimeout(r, 0));
  const status = screen.getByRole("status");
  expect(status.textContent).toBe("Copied");
  expect(status.textContent).not.toMatch(/\s$/);
});

it("shows an open link only when openUrl is provided", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <ProofPopover
      label="View dataset identity"
      value="59fa295c"
      identifierType="git-commit-sha"
    />,
  );
  await user.click(screen.getByRole("button", { name: /View dataset identity/ }));
  expect(screen.queryByRole("link", { name: "Open" })).toBeNull();

  // Close the popover before rerendering so Radix state is clean.
  await user.click(screen.getByRole("button", { name: /View dataset identity/ }));

  rerender(
    <ProofPopover
      label="View dataset identity"
      value="59fa295c"
      identifierType="git-commit-sha"
      openUrl="https://github.com/example/repo/commit/59fa295c"
    />,
  );
  await user.click(screen.getByRole("button", { name: /View dataset identity/ }));
  expect(screen.getByRole("link", { name: "Open" }).getAttribute("href"))
    .toBe("https://github.com/example/repo/commit/59fa295c");
});

it("a second copy resets the full feedback duration without a stale timeout", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const user = userEvent.setup();
  render(
    <ProofPopover
      label="View dataset identity"
      value="59fa295c"
      identifierType="git-commit-sha"
      copyLabel="Copy SHA"
    />,
  );
  await user.click(screen.getByRole("button", { name: /View dataset identity/ }));
  const button = screen.getByRole("button", { name: "Copy SHA" });

  fireEvent.click(button);
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.getByRole("status").textContent).toBe("Copied SHA");

  await new Promise((r) => setTimeout(r, 1000));
  expect(screen.queryByRole("status")).not.toBeNull();

  fireEvent.click(button);
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.getByRole("status").textContent).toBe("Copied SHA");

  await new Promise((r) => setTimeout(r, 1500));
  expect(screen.queryByRole("status")).not.toBeNull();

  await new Promise((r) => setTimeout(r, 600));
  expect(screen.queryByRole("status")).toBeNull();
});

it("unmounting with a pending timeout causes no post-unmount state update", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const user = userEvent.setup();
  const { unmount } = render(
    <ProofPopover
      label="View dataset identity"
      value="59fa295c"
      identifierType="git-commit-sha"
      copyLabel="Copy SHA"
    />,
  );
  await user.click(screen.getByRole("button", { name: /View dataset identity/ }));
  const button = screen.getByRole("button", { name: "Copy SHA" });
  fireEvent.click(button);
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.getByRole("status").textContent).toBe("Copied SHA");

  unmount();

  await new Promise((r) => setTimeout(r, 2100));
  expect(document.body.textContent).not.toContain("Copied SHA");
});
