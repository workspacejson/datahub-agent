/**
 * The tally lockup, per the approved nav spec.
 *
 * The mark is inline SVG at 24px and the word is real HTML text, not the
 * `tally-lockup.svg` artifact. That file sets the word in a live SVG text node
 * with a `font-family`, so it re-renders in whatever fallback face the viewer has
 * and its metrics move; it stays the standalone asset for contexts needing one
 * file. Here the word is selectable, scales with the type ramp, and honours the
 * three brand rules directly: not tinted emerald, not set in mono, and the mark
 * never sits on an accent fill.
 *
 * `workspace.json` is the substrate, not the application, so it never appears
 * here. It is named in the footer, in the sentence that says what tally is.
 *
 * It lives in its own file because two surfaces render it now: the cockpit shell
 * and the surface a reader lands on when a path resolves to no route. A copy in
 * the second one would be a second lockup free to drift from the spec.
 */
export function Wordmark() {
  return (
    <p className="wordmark">
      <svg className="wordmark__mark" viewBox="0 0 104 96" width="36" height="33" aria-hidden="true" focusable="false">
        <g fill="#00c896">
          <rect x="6" y="6" width="7" height="84" /><rect x="6" y="6" width="22" height="7" /><rect x="6" y="83" width="22" height="7" />
          <rect x="91" y="6" width="7" height="84" /><rect x="76" y="6" width="22" height="7" /><rect x="76" y="83" width="22" height="7" />
        </g>
        <g fill="currentColor">
          <rect x="32" y="18" width="7" height="60" /><rect x="45" y="18" width="7" height="60" />
          <rect x="58" y="18" width="7" height="60" /><rect x="71" y="18" width="7" height="60" />
        </g>
        <path d="M26 74 L84 38" stroke="currentColor" strokeWidth="7" />
      </svg>
      <span className="wordmark__word">tally</span>
      <span className="wordmark__rule" aria-hidden="true" />
      <span className="wordmark__product">Change impact cockpit</span>
    </p>
  );
}
