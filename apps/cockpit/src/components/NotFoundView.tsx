import type { MouseEvent } from "react";
import { Wordmark } from "./Wordmark";

/**
 * The path that resolved to no route, and the one way back.
 *
 * This replaces a silent substitution. `readLocation` parsed the path with
 * `cockpitRouteSchema.catch("impact")`, so every unrecognised path rendered the
 * impact review: a mistyped, truncated or retired link produced a complete
 * review under a URL that never named it, and nothing on screen said so. The
 * address bar kept asserting a route the app had already declined, which is the
 * same defect class as a stale `?dataset=` key surviving navigation.
 *
 * The artwork is option 1c of `404 mark.dc.html`: the mark's gate in accent with
 * its five strokes reduced to a ghost, the code beside it, and the status in
 * mono. An empty gate is the mark's own notation for a count that never
 * happened, which is what an unresolved path is.
 *
 * Emerald here is the brand mark, the role it already plays in the wordmark. It
 * carries no attribution and no resolution meaning: nothing on this surface was
 * contributed or resolved by anything.
 *
 * One decision, so one control. The canvas's page treatment offers "Report a
 * broken link" beside the return; there is nothing behind that action here, and
 * a second primary-weight control would compete with the only one that works.
 */

/**
 * How much of an unresolved path is printed.
 *
 * The path is a real value read from the address bar, so it is stated rather
 * than summarised -- a reader checking a mistyped link needs to see what was
 * actually requested. It is also the one string on this surface with no upper
 * bound, and `overflow-wrap` alone still lets a 2KB path grow the frame past the
 * fold and push the return with it.
 */
const PATH_DISPLAY_LIMIT = 96;

/**
 * Both props are optional, because this component has two producers.
 *
 * `App` renders it with both: it knows the path the reader asked for, and the
 * return is an in-app navigation. `vite.config.ts` also renders it to static
 * markup at build time for `404.html`, the document Vercel serves with a real
 * 404 status, and that document is one file answering every unmatched path --
 * so at build time there is no path to name and no app state to update.
 *
 * The static document says so rather than guessing: "No route is bound to this
 * path." The script then boots the app on the same URL, which knows the path and
 * states it. What a reader sees with JavaScript disabled is the true subset of
 * what they see with it enabled, never a different claim.
 */
export function NotFoundView({ path, onReturn }: { path?: string; onReturn?(): void }) {
  const shown = path !== undefined && path.length > PATH_DISPLAY_LIMIT
    ? `${path.slice(0, PATH_DISPLAY_LIMIT)}…`
    : path;

  /*
    A real link, not a button styled as one. It can be copied, opened in a new
    tab, and followed with the keyboard, and it still resolves if this script
    never runs -- which matters most here, since the reader is already somewhere
    the app did not expect. The handler is the in-app shortcut, and it defers to
    the browser for modified and non-primary clicks.
  */
  const returnToReview = (event: MouseEvent<HTMLAnchorElement>) => {
    if (onReturn === undefined) return;
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onReturn();
  };

  return (
    <main className="cockpit-shell not-found">
      {/*
        The lockup alone. The bar's status line states what the review surface
        does, and there is no review on this path to say it about.
      */}
      <header className="product-header">
        <Wordmark />
      </header>

      <section className="not-found__frame" aria-labelledby="not-found-title">
        <svg className="not-found__gate" viewBox="0 0 104 96" aria-hidden="true" focusable="false">
          <g className="not-found__brackets">
            <rect x="6" y="6" width="7" height="84" /><rect x="6" y="6" width="22" height="7" /><rect x="6" y="83" width="22" height="7" />
            <rect x="91" y="6" width="7" height="84" /><rect x="76" y="6" width="22" height="7" /><rect x="76" y="83" width="22" height="7" />
          </g>
          <g className="not-found__strokes">
            <rect x="32" y="18" width="7" height="60" /><rect x="45" y="18" width="7" height="60" />
            <rect x="58" y="18" width="7" height="60" /><rect x="71" y="18" width="7" height="60" />
            <path d="M26 74 L84 38" strokeWidth="7" />
          </g>
        </svg>

        <div className="not-found__statement">
          <h1 id="not-found-title" className="not-found__code">404</h1>
          <p className="eyebrow">Nothing to count here</p>
          <p className="not-found__path">
            {shown === undefined
              ? "No route is bound to this path."
              : <>No route is bound to <span className="mono">{shown}</span>.</>}
          </p>
          <a className="cta not-found__return" href="/" onClick={returnToReview}>
            Go to the impact review
          </a>
        </div>
      </section>

      <footer className="cockpit-footer">
        <p className="cockpit-footer__role">
          Tally is the join between DataHub and{" "}
          <a
            href="https://github.com/workspacejson/standard"
            target="_blank"
            rel="noopener"
            aria-label="workspace.json standard on GitHub, opens in a new tab"
          >
            workspace.json
          </a>
          . Open-source, Apache 2.0.
        </p>
      </footer>
    </main>
  );
}
