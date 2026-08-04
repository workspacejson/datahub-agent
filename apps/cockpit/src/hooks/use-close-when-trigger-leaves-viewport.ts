import { useEffect, useRef, type RefObject } from "react";

/**
 * Close an anchored overlay once its trigger has fully left the viewport.
 *
 * The defect this fixes is orphaning, not persistence. `TermDefinition` and
 * `ProofPopover` both close on Escape and on outside click, which is the
 * expected pair and stays. What neither did was notice that the element they are
 * anchored to had gone: scrolling past the header left an open, focused panel
 * pointing at nothing, still in the accessibility tree, and still open when the
 * reader scrolled back.
 *
 * Deliberately not a timer. Auto-dismiss on a clock is the convention for
 * transient, system-initiated messages — toasts, snackbars — not for content a
 * reader deliberately opened. WCAG 2.2.1 puts time limits on reading content
 * under an adjustable requirement, and the definitions here run to a full
 * sentence. On a surface whose whole claim is that evidence stays checkable,
 * explanatory text that removes itself on a clock is the wrong instinct twice
 * over.
 *
 * Deliberately not "close on scroll" either. A reader may scroll a little to see
 * the term in the sentence it came from while the definition is open; closing on
 * the first wheel event punishes exactly the attentive reading this surface
 * wants.
 *
 * `isIntersecting` with the default threshold means *any* pixel of the trigger
 * is visible, so `false` is the full-exit condition and no ratio threshold is
 * needed. A partially clipped trigger keeps its overlay open, which is the
 * intended rule and not an accident of the default.
 */
export function useCloseWhenTriggerLeavesViewport(
  triggerRef: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
): void {
  /**
   * The callback, held by ref so it is not an effect dependency.
   *
   * Callers pass `() => setOpen(false)`, a new function identity every render.
   * As a dependency that would tear down and rebuild the observer on each one,
   * and `observe()` delivers an initial entry synchronously after connecting —
   * so the churn is not merely wasteful, it re-runs the close check constantly
   * against a fresh observer that has no history.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const trigger = triggerRef.current;
    // No observer while closed: nothing to orphan, and observing a trigger whose
    // overlay is already shut would close it again on every scroll.
    if (!open || !trigger) return;
    // jsdom has no IntersectionObserver, and neither do a few browsers this may
    // still be opened in. Absent the observer the overlay keeps its previous
    // behaviour — open until Escape or an outside click — rather than throwing
    // on a surface whose job is to render evidence.
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver((entries) => {
      // The last entry, not the first. A batch can carry several records for one
      // target when several thresholds cross in a frame, and the earliest is the
      // stalest reading in it.
      const entry = entries[entries.length - 1];
      if (entry && !entry.isIntersecting) onCloseRef.current();
    });

    observer.observe(trigger);
    return () => observer.disconnect();
  }, [open, triggerRef]);
}
