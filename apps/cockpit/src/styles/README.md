# Cockpit styles

```
styles.css            entry point; imports only, in a fixed order
styles/base.css       element defaults
styles/cockpit.css    the app's own component rules
styles/tokens/        design values, and nothing else
```

## Where the tokens come from

`tokens/colors.css`, `typography.css`, `spacing.css` and `effects.css` are
**verbatim copies** from the approved workspace.json design system, package
`workspace-json-design-system-b8d83ce8-fa46-4b07-8519-19c3ef0a739e`. Syncing is a
diff against that package, not an audit of a stylesheet, which is the reason they
are unmodified.

Two files are not copies, and both say so in their own header:

- **`tokens/fonts.css`** is rewritten. The system's version `@import`s both
  families from Google Fonts. The cockpit binds its evidence at build time so a
  judge needs no network, and a render-time font fetch gives that back for a
  typeface. Faces resolve locally and fall through to system stacks. To ship the
  brand faces, self-host woff2 under `public/fonts/` and add `@font-face` here.
- **`tokens/app-overrides.css`** holds every deliberate deviation, loaded last so
  it wins. Currently one: `--text-faint` is raised off `--wj-gray-4`, which
  measures 3.9:1 at 11px on the card surface and fails WCAG AA.

Deviations go in that file rather than into a copied token, so a deviation cannot
pass itself off as fidelity.

## Design sources

The canonical frames and the alignment audit prompt live in `design/` at the
repository root. They are design sources of record, not app assets, and nothing
here imports them.

## The two encodings that carry meaning

Colour reinforces; shape and the literal word carry the state, so every state is
still nameable in greyscale.

- **Emerald** is reserved for `workspace.json` attribution and the primary CTA.
  It never carries resolution meaning: "resolved" rendered in the brand colour
  reads as "we generated this".
- **Dashed** is unresolved, **dotted** is not queried, both on the neutral ramp.
  Amber is unsettled, red is an error. A merely-unresolved item gets neither.

Source and resolution are separate chips and are never collapsed into one, so a
DataHub-sourced claim can read unresolved and a `workspace.json`-sourced one can
read declared.
