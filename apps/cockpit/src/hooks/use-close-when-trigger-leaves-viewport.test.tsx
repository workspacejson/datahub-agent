import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProofPopover } from "../components/ProofPopover";
import { TermDefinition } from "../components/TermDefinition";

/**
 * Closing an anchored overlay once its trigger has fully left the viewport.
 *
 * jsdom has no layout, so a real `IntersectionObserver` here would report
 * nothing useful even if it existed. These tests therefore install a fake one
 * and drive it directly: the hook's contract is "when the observer reports the
 * trigger is not intersecting, close", and that contract is exactly what a fake
 * can exercise honestly. Whether real scrolling produces that report is a
 * question about a browser, and is asserted in `e2e/popover-dismissal.spec.ts`
 * against three of them.
 */

interface FakeObserver {
  target: Element | null;
  disconnected: boolean;
  /** Deliver an entry, as the real observer would after a scroll. */
  emit(isIntersecting: boolean): void;
}

let observers: FakeObserver[] = [];

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private readonly callback: IntersectionObserverCallback;
      private readonly record: FakeObserver;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        this.record = {
          target: null,
          disconnected: false,
          emit: (isIntersecting: boolean) => {
            this.callback(
              [{ isIntersecting, target: this.record.target } as unknown as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            );
          },
        };
        observers.push(this.record);
      }
      observe(target: Element) {
        this.record.target = target;
      }
      disconnect() {
        this.record.disconnected = true;
      }
      unobserve() {}
      takeRecords() {
        return [];
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const live = () => observers.filter((o) => !o.disconnected);

describe.each([
  {
    name: "TermDefinition",
    element: <TermDefinition term="repo-evidence artifact" definition="A JSON file committed to the repository." />,
    triggerName: /repo-evidence artifact/,
    panel: ".term-def__panel",
  },
  {
    name: "ProofPopover",
    element: <ProofPopover label="View dataset identity" value="urn:li:dataset:(x)" identifierType="dataset-urn" />,
    triggerName: /View dataset identity/,
    panel: ".proof-popover__panel",
  },
])("$name closes when its trigger leaves the viewport", ({ element, triggerName, panel }) => {
  const open = async () => {
    const user = userEvent.setup();
    render(element);
    await user.click(screen.getByRole("button", { name: triggerName }));
    expect(document.querySelector(panel)).not.toBeNull();
    return user;
  };

  it("observes nothing until the overlay is open", () => {
    render(element);
    // A closed overlay has nothing to orphan. Observing anyway would mean a
    // scroll past a never-opened trigger runs a close path on every frame.
    expect(observers).toHaveLength(0);
  });

  it("observes the trigger itself once open, not the panel", async () => {
    await open();
    expect(live()).toHaveLength(1);
    expect(live()[0].target).toBe(screen.getByRole("button", { name: triggerName }));
  });

  it("closes when the trigger reports fully out of view", async () => {
    await open();
    act(() => live()[0].emit(false));
    expect(document.querySelector(panel)).toBeNull();
  });

  it("stays open while any part of the trigger is still visible", async () => {
    // The rule is full exit, not partial clipping. With the default threshold
    // `isIntersecting` is true for a single visible pixel, so this is the case
    // that separates "scrolled a little to reread the sentence" from "gone".
    await open();
    act(() => live()[0].emit(true));
    expect(document.querySelector(panel)).not.toBeNull();
  });

  it("disconnects when the overlay closes, leaving no observer behind", async () => {
    const user = await open();
    await user.keyboard("{Escape}");
    expect(document.querySelector(panel)).toBeNull();
    expect(live()).toHaveLength(0);
  });

  it("disconnects on unmount while still open", async () => {
    await open();
    expect(live()).toHaveLength(1);
    cleanup();
    expect(live()).toHaveLength(0);
  });

  it("does not reopen itself after closing on exit", async () => {
    // Closing sets `open` false, which tears the observer down. If a stale
    // observer survived and later reported intersecting, nothing should bring
    // the panel back: re-entry is a decision for the reader, not the scroll.
    await open();
    const observer = observers[0];
    act(() => observer.emit(false));
    expect(document.querySelector(panel)).toBeNull();
    act(() => observer.emit(true));
    expect(document.querySelector(panel)).toBeNull();
  });
});

describe("the guard itself", () => {
  it("would not detect a close that never happened", async () => {
    /*
      The detector, against a constructed non-violation. Every assertion above
      is `toBeNull()` on a panel, and a component that failed to open at all
      would satisfy most of them without the hook existing. This pins the other
      direction: the panel is present before the observer fires, so the null
      afterwards is attributable to the close and not to a render that never
      produced anything.
    */
    const user = userEvent.setup();
    render(<TermDefinition term="repo-evidence artifact" definition="A JSON file." />);
    await user.click(screen.getByRole("button", { name: /repo-evidence artifact/ }));
    expect(document.querySelector(".term-def__panel")).not.toBeNull();
    expect(live()).toHaveLength(1);
  });

  it("leaves the overlay usable where IntersectionObserver does not exist", async () => {
    // Degrades to the previous behaviour rather than throwing. An evidence
    // surface that renders nothing is worse than one whose overlay outlives its
    // anchor on a browser too old to say so.
    vi.stubGlobal("IntersectionObserver", undefined);
    const user = userEvent.setup();
    render(<TermDefinition term="repo-evidence artifact" definition="A JSON file." />);
    await user.click(screen.getByRole("button", { name: /repo-evidence artifact/ }));
    expect(document.querySelector(".term-def__panel")).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(document.querySelector(".term-def__panel")).toBeNull();
  });
});
