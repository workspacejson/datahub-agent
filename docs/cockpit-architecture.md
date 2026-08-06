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

## What the mapper may derive, and what it may not invent

**Ruled 2026-08-04, from a defect that shipped.**

`from-change-impact-event.ts` projects a validated event onto `CockpitViewModel`.
It may derive presentation structure from fields present in that event. It must
not introduce factual claims, evaluation results, or absence reasons the event
does not carry.

| Allowed derivation | Disallowed invention |
| --- | --- |
| grouping records | adding a new factual claim |
| formatting paths | asserting an evaluation result |
| ordering sections | inventing an absence reason |
| deriving display labels from enums | supplying unsupported provenance |

The line is not "no literals". Some absence reasons are legitimate constants:
naming which digest is missing *because this event carries no `verification`
block* is a statement about the event, checked against the event, and it changes
when the event changes. What is forbidden is a literal that asserts something
about the world the event says nothing about.

The defect that produced this rule was `receipt.evaluation.pairedSpread`, an
unconditional `missing("The paired DataHub-only vs joined evaluation has not been
run.")`. It read nothing and checked nothing, so it kept rendering after HAC-150
ran the evaluation: the build cited a ten-run result on Change plan and denied it
on Receipts, under a heading that reads "Limitations lead". Removed in #75.

A hardcoded absence is the worst shape this defect takes. A stale positive claim
looks like a bug; a stale disclosure looks like integrity, and survives the
review that would have caught the opposite. That asymmetry is why the rule is
recorded at the boundary rather than left in the fix history.

**Known outstanding instance.** `receipt.evaluation.locBaseline` is the same
shape: an unconditional `missing("No lines-of-code baseline has been measured.")`.
It is deliberately retained because it still states something true, no
lines-of-code baseline exists anywhere in `evaluation/`, and deleting an accurate
disclosure to satisfy a structural rule would trade one honesty problem for
another. It becomes a violation of this rule the day a baseline is measured, and
the mapper comment says so at the site.

## Artifact precedence

Several artifacts can speak to the same question, and they do not carry equal
weight. Where they conflict, the earlier entry wins:

1. **Validated event contract** (`src/integration/change-impact-event.ts`). The
   frozen vocabulary. Nothing downstream may widen or reinterpret it.
2. **Recorded architecture rulings** (this document,
   `tally-architecture-motion.md`). Decisions taken with their losing alternative
   written beside them.
3. **Route-specific specifications** (HAC-218 for Receipts, HAC-219 and HAC-226
   for writeback).
4. **Design references and canvases** (`design/cockpit/*.dc.html`). Proposals.
   Authoritative for nothing on their own.
5. **Issue discussion.** Context for why a decision was taken, not the decision.

A canvas is the most common source of accidental authority here, because it is
the most finished-looking artifact in the list and the easiest to open. It is a
proposal. Two of its frames have already been ruled against, and both rulings are
recorded above rather than only in their issues, so that opening the canvas alone
cannot reopen a settled question.

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

Where the canvas Receipts frame conflicts with this ruling, this document is
authoritative and the canvas frame must not be implemented. Two consequences,
both deliberate:

- Its four statements do not map onto the seven sections, and no attempt should
  be made to force the mapping. The sections are the evidence structure.
- Its "Plan changed" statement has no home here. The Change plan route owns that
  comparison, and stating it twice would be the double assertion the receipt
  exists to avoid.

Recorded here rather than only in the issue, for the same reason the motion beat
order is recorded in `tally-architecture-motion.md`: a ruling that lives beside
the losing statement lets the next consumer pick either one.

### Refused a second time, 2026-08-06

`Screen reduction spec.dc.html` proposes the same demotion in a different shape:
five causally ordered receipt bands with "Not written, or still unknown" placed
**last**, on the reasoning that residuals are "the closing statement of the
receipt, which is where a reviewer looks for what is missing."

Refused, and the reasoning above is unchanged by the new shape. Leading with the
absence is not a claim about where a reviewer looks; it is a claim about what
outranks what. A receipt that opens with what it checked and closes with what it
could not establish reads as a process log with a caveat appended, which is the
exact reading HAC-218 ruled against. The rest of that spec's Receipts proposal
is compatible and was not implemented only because it travels with the reorder.

This is now the second distinct canvas to propose it, which is why the refusal is
recorded here with the proposal named rather than left in a commit message. The
first refusal cited the canvas by name and a later spec still arrived proposing
it, so naming this one too is the cheapest thing that makes a third proposal
answerable by reading rather than by re-litigating.
