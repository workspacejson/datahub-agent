# Cockpit architecture boundary (HAC-224)

`apps/cockpit` is the one native npm-workspace UI application. It uses React 19,
TypeScript, Vite 8, Tailwind 4, Radix/shadcn-compatible primitives, Zod 4,
Vitest/React Testing Library, and Playwright/axe. URL/local React state is the
state mechanism; TanStack Query is reserved for a real asynchronous DataHub read
or mutation.

The excluded stack is Turborepo, Next.js, Redux, Zustand, XState, dashboard
templates, TanStack Table, charts, Framer Motion, React Flow, Dagre, and ELK.
React Flow has no admission without a recorded comprehension failure; a static
accessible impact rail remains the baseline.

All source events cross Zod into `CockpitViewModel`; components accept only that
model. Invented values occur only in `src/data/provisional-source.ts`, imported
only by `cockpit-adapter.ts`. The provisional adapter marks the complete model
`placeholder`, which makes the persistent warning automatic.

There are two source modes, `placeholder` and `committed`, and `committed` is the
default for both `dev` and `build`. Any build throws on `placeholder` and on an
unrecognised mode; the guard keys on Vite's `command` rather than `NODE_ENV`,
which is ambient and was bypassable. `committed` names how the build acquired its
evidence: it reads a committed event at build time and fetches nothing. How that
evidence was *produced* is a per-evidence question the event's own `provenance`
block answers.

There used to be a third mode, `live`. It took the same branch as `fixture`, read
the same bytes, and produced the same projection, so it asserted a connection
that never happened and the parity check comparing the two held by construction.
Both the third mode and that check are gone. `architecture-invariants` now asserts
that no module the browser loads can reach the network and that no stylesheet
loads a remote font, so the offline property is enforced rather than described.

HAC-218 and HAC-219 consume the model/route slots, never provisional source data.
