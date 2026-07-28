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
`placeholder`, which makes the persistent warning automatic. Production and
judge Vite builds throw when `COCKPIT_SOURCE_MODE=placeholder`; the build script
uses the intentionally unavailable live adapter until evidence binding lands.

Fixture/live parity compares normalized models with only `sourceMode` excluded.
HAC-218 and HAC-219 consume the model/route slots, never provisional source data.
