# Cockpit architecture boundary (HAC-224)

> **Type:** Reference | **Status:** Current | **Scope:** Cockpit application boundary

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

## Receipts lead order — ruled and standing

**Ruled 2026-08-03: HAC-218 remains authoritative for Receipts.**

Receipts leads with what is not established. The absence band stays first, the
seven-section evidence structure is preserved, and "Plan changed" is owned by the
Change plan route rather than restated here.

`Tally cockpit ideal state.dc.html` proposes the inverse: four expandable outcome
statements lead, with limitations fourth, under the heading "Result outranks
limitation". That principle governs the hero, where it was adopted. It does not
extend to Receipts, because on this route **unestablished evidence is itself a
result**. Demoting it below the outcomes would rank a finding beneath a summary
of the findings, on the one surface whose job is to say what is not known.

The canvas's Receipts frame is therefore non-applicable where it conflicts with
this ruling. Two consequences, both deliberate:

- Its four statements do not map onto the seven sections, and no attempt should
  be made to force the mapping. The sections are the evidence structure.
- Its "Plan changed" statement has no home here. The Change plan route owns that
  comparison, and stating it twice would be the double assertion the receipt
  exists to avoid.

Recorded here rather than only in the issue, for the same reason the motion beat
order is recorded in `tally-architecture-motion.md`: a ruling that lives beside
the losing statement lets the next consumer pick either one.
