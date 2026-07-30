import { useEffect, useState } from "react";

import type { CockpitRoute, CockpitViewModel } from "../model/cockpit-view-model";

/**
 * The named gaps, the consequence of proceeding, and the one action that does.
 *
 * It is a rail rather than a footer because of where it has to be readable. The
 * primary action used to sit at the end of the Impact column, at `y = 1378` on a
 * 1533px page: 478px below a 1440x900 fold and 578px below a 1280x800 one.
 * HAC-228 shows a cold reader the first frame for five seconds and forbids
 * scrolling, then asks what the next action is, so an action below the fold is an
 * action that does not exist for the question being asked.
 *
 * It no longer restates coverage. Coverage is asserted once, in the hero band;
 * this card carries only what proceeding accepts and the control that proceeds.
 * Two wordings of one fact 900px apart made neither authoritative.
 */

/** The sections a reader might want to reach on Receipts, in page order. */
const RECEIPT_SECTIONS = [
  { id: "unestablished-title", label: "What is not established" },
  { id: "evidence-title", label: "Evidence standing" },
  { id: "accounting-title", label: "Resolution accounting" },
  { id: "provenance-title", label: "Provenance" },
  { id: "writeback-title", label: "Writeback proof" },
  { id: "disclosure-title", label: "Evaluation and disclosure" },
] as const;

/**
 * Wayfinding for the one route that needs it.
 *
 * Receipts is roughly 1.8 screens taller than the other two combined and holds
 * six distinct arguments, none of which appeared in any navigation: the only way
 * to answer "show me the writeback proof" was to scroll and read headings. The
 * rail was simultaneously empty there, so the widest column on the page was
 * unused exactly where wayfinding was needed most.
 *
 * The active section is observed rather than tracked on scroll position, so the
 * highlight follows what is actually on screen and costs no scroll handler.
 */
function SectionIndex() {
  const [active, setActive] = useState<string>(RECEIPT_SECTIONS[0].id);

  useEffect(() => {
    const headings = RECEIPT_SECTIONS
      .map(({ id }) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (headings.length === 0) return;

    /*
     * Active is the last heading scrolled past, with one exception: at the bottom
     * of the page it is the last section outright.
     *
     * Both details were found by measuring rather than reasoning. An
     * IntersectionObserver over a narrow band left the highlight stuck on
     * whichever heading last crossed it, so scrolling past several sections at
     * once never updated. Recomputing from live positions fixed that but still
     * never reached the final two sections, because the page bottom arrives before
     * their headings reach the top of the viewport: with a short last section,
     * "scrolled past" is unreachable and the index would never highlight it.
     *
     * A passive scroll listener, coalesced to one read per frame, is what this
     * actually needs. `IntersectionObserver` cannot express "the last one above a
     * line" without reading positions anyway.
     */
    let frame = 0;
    const sync = () => {
      frame = 0;
      const doc = document.documentElement;
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 4) {
        setActive(headings[headings.length - 1].id);
        return;
      }
      const passed = headings.filter((heading) => heading.getBoundingClientRect().top <= 96);
      setActive((passed.length > 0 ? passed[passed.length - 1] : headings[0]).id);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(sync);
    };

    sync();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <aside className="decision-rail">
      {/* The name belongs on the navigation landmark, not on the wrapper. */}
      <nav className="rail-group rail-index" aria-label="Receipt sections">
        <p className="eyebrow">On this receipt</p>
        <ul>
          {RECEIPT_SECTIONS.map(({ id, label }) => (
            <li key={id} className={active === id ? "is-active" : ""}>
              <a href={`#${id}`} aria-current={active === id ? "location" : undefined}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

/** What proceeding accepts, composed from the count rather than asserted. */
function consequence(model: CockpitViewModel): string {
  const gaps = model.receipt.statedGaps.length;
  if (gaps === 0) return "No gaps are stated. Proceeding accepts the review as it stands.";
  return `Proceeding accepts ${gaps} stated gap${gaps === 1 ? "" : "s"}.`;
}

export function DecisionRail({ model, route, onRouteChange }: {
  model: CockpitViewModel;
  route: CockpitRoute;
  onRouteChange(route: CockpitRoute): void;
}) {
  if (route === "receipts") return <SectionIndex />;

  const gaps = model.receipt.statedGaps;
  return (
    <aside className="decision-rail" aria-label="Stated gaps and next action">
      <div className="rail-group">
        <p className="eyebrow">Stated gaps, named ({gaps.length})</p>
        {gaps.length === 0 ? (
          <ul><li>No gaps are stated for this event.</li></ul>
        ) : (
          <ul>
            {gaps.map((gap) => (
              <li key={gap.field}>
                <strong>{gap.field}</strong>
                <span className="rail-group__reason">{gap.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        One decision per view, and only Impact has one: proceed with the stated
        gaps accepted, or stop. Change plan has a single forward move, so it gets
        a single button; offering a second there made back-navigation look like a
        choice with consequences.
      */}
      <div className="rail-group">
        <p className="rail-caveat">{consequence(model)}</p>
        {route === "impact" ? (
          <>
            <button className="cta" type="button" onClick={() => onRouteChange("change-plan")}>Continue to change plan</button>
            <button className="cta cta--secondary" type="button" onClick={() => onRouteChange("receipts")}>Stop, do not edit</button>
          </>
        ) : (
          <button className="cta" type="button" onClick={() => onRouteChange("receipts")}>Review receipts</button>
        )}
      </div>
    </aside>
  );
}
