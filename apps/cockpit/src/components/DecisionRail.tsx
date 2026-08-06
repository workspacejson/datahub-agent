import { useEffect, useState } from "react";

/**
 * Wayfinding for the one route that needs it.
 *
 * This file used to carry two things: the sticky decision card on Impact and
 * Change plan, and the section index on Receipts. The decision is now a band
 * across the frame, under the evidence it decides on, so only the index is left
 * -- which is what the rail was always good at and the only route tall enough to
 * need it.
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


/**
 * The rail, which is now exactly the section index.
 *
 * It takes no props. The decision card it used to sit above read the model for a
 * gap count and a route for which buttons to offer; neither is this component's
 * business any more, and keeping the parameters would leave a signature that
 * implies it still decides something.
 */
export function DecisionRail() {
  return <SectionIndex />;
}
