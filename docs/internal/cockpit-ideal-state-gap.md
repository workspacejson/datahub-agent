# Deltas Between Current Codebase and the Audited Ideal State

> **Type:** Internal | **Status:** Superseded, retained as history | **Scope:** One audit, answered
>
> **Do not use this document to derive current behavior.** It was written against
> source at `08b4260` and the reduction pass has since moved or deleted most of
> what it anchors on: `DecisionRail` lost the CTAs and the one-decision comment to
> `DecisionBar`, `firstAction` and the "First step changed" label were removed
> from `ChangePlanView` outright, `provenanceRows` moved, `cockpit.css` grew from
> 1195 to 1413 lines, and every `ImpactView` line number in Part 2 is stale. The
> Linear board in Part 3 was already marked "not re-verified" when written.
>
> The two rulings this document was the last home for have been moved somewhere
> that cannot drift: the no-decision-field ruling is now enforced by
> `apps/cockpit/src/house-copy.test.tsx` and explained in
> `docs/cockpit-architecture.md`, and D9's grouping constraint and D10's
> `evidence-path` question are recorded as open questions in the same document.
> Nothing else here is load-bearing.

Gap analysis mapping every claim in the design audit against the actual state of the repo, ending in an updated execution order.

**Verification status:** every code claim below was checked against source at `08b4260` (PR #72). Line numbers, file paths, fixture values, and PR timestamps are confirmed unless a `⚠️` note says otherwise. Where verification changed the finding, the correction is inline and marked.

---

## Part 0 — Already landed (no delta)

The audit was written against older screenshots. These recommendations are **already implemented** — all confirmed by reading source:

- **Persistent standing of the review** — ~~`OutcomeBar.tsx` renders Source / Lineage / Coverage / Plan / Writeback / Limitations on every route.~~ **Superseded by the reduction pass:** the six-cell strip was removed and each fact now appears once, in the band that owns it. Resolution and the pinned revision are on `ResolvedSource` (every route); coverage and the named residuals are in `ScopeStrip`; lineage counts and the writeback are in `ContributionBand`. SHA shortening moved to `format.ts` (`shortRevision`, `/^[0-9a-f]{40}$/i` → `slice(0, 8)`).
- **Full hero only on Impact** — ~~`CockpitShell.tsx:293-321` gates the silent-zero pair and coverage band to the Impact route.~~ **Superseded:** the hero is now the subject band and renders on every route; the silent zero moved into `ImpactView` below the fold, and the coverage band became `ScopeStrip`, rendered on Impact and Change plan. What is Impact-only is now the contribution band and the plan delta.
- **Join difference made structural** — `CoordinateSeam` at `ImpactView.tsx:74-94` renders the missing prefix as an explicit `?` slot vs the resolved prefix.
- **VERIFIED no longer conflicts with coverage** — tier moved into "The tier is a count, not a warrant" (`ReceiptsView.tsx:158+`); no naked VERIFIED.
- **Parity metadata collapsed** — task/model/digest behind `<details>How this comparison was controlled</details>` (`ChangePlanView.tsx:139-178`).
- **Receipt section index** — scroll-tracked nav in `DecisionRail.tsx:42-107`.
- **Receipt export** — copy/download of raw evidence, disabled when unobserved.
- **Limitation dedup** — confirmed structurally: `provenanceRows` (`ReceiptsView.tsx:56-72`) deliberately omits `limitations`, with the reason documented in-place.
- **PR #70** — merged 2026-08-03 02:51:53Z ✅ confirmed via API.
- **PR #71** (HAC-270 evidence-tier lattice) — merged 2026-08-03 12:39:40Z ✅ confirmed via API.

---

## Part 1 — Narrative deltas (the load-bearing defect)

### D1. Hero stakes sentence claimed the absent capability — ✅ LANDED (`e88cd3b`)

`ImpactView.tsx:281` reads verbatim:

> "DataHub says where data flows; git says what breaks together; *joining them* silently returns nothing. Here is the proof."

The receipt contradicts it. The shipped bundle states:

```json
{ "field": "partners", "source": "workspacejson", "reason": "indeterminate",
  "detail": "The artifact resolves the exact source but contains no behavioral
             co-change evidence, so no partners are asserted." }
```

So "git says what breaks together" claims exactly the capability the receipt disclaims. This is the load-bearing defect and the finding is sound.

**Landed as:** "DataHub says where data flows; **git says where each file lives**; *joining them* silently returns nothing. Here is the proof."

Only the false clause changed. The mechanism, the `TermDefinition` on the coordinate-system mismatch, and the "Here is the proof" close are intact.

> ⚠️ **Two corrections to the audit's version of this fix.**
> 1. The hero sentence is **not** pinned in `house-copy.test.tsx`, so the edit was cheaper than the audit implied.
> 2. The audit's proposed replacement ended "…the agent gets zero matches and no warning." That would have **restated the pinned silent-zero callout**, which renders directly above it on Impact and already reads "Naive join: 0 matches. No error. No warning. Exit code 0." House copy requires each fact stated once per route, so the numbers were left to the callout that owns them. The stakes line keeps its job: the mechanism, not the instance.

Verified green: `typecheck`, 761 + 187 tests, 57/57 e2e.

### D2. Linear project description was out of parity — ✅ LANDED

Two phrases in the project description promised behavioral co-change:

| Section | Was | Now |
| --- | --- | --- |
| Winning thesis | "the exact producer file and **code partners learned from repository history**" | "the exact producer file and **the revision it is pinned at**" |
| Product shape → Impact | "lineage, producer file, **behavioral code partners**, immutable View Source" | "lineage, producer file, **pinned revision**, immutable View Source" |

Nothing else in the description changed. HAC-154's message lock already used the narrowed wording, so the project description was the last outlier.

> Worth considering: the Guardrails list already carries "No invented risk score or universal maintainability claim." A companion line — *no behavioral co-change or code-partner claim* — would stop this specific drift from returning. Not added unasked.

---

## Part 2 — Cockpit UI deltas (`apps/cockpit`)

### Impact (`ImpactView.tsx`, `CockpitShell.tsx`)

- **D3. Result vs Coverage status groups.** Split into **Result: Exact source resolved** and **Coverage: Lineage completeness not established**. Amber stays, subordinated.
  *Backend: aligned.* `resolutionDisposition` and `completeness` are already separate fields on the view model. Pure presentation regrouping, no contract change.

- **D4. Internal field name arrives too early.** ✅ confirmed. `ResolutionSeam` (`ImpactView.tsx:96-122`) renders `gap.field` — i.e. `code.repositoryRelativePath` — as the first thing in the row. Lead with prose; move the contract field behind a "How this was resolved" disclosure.
  *Backend: aligned.* Both `gap.field` and `gap.detail` are already carried.

- **D5. Lineage defaults to expanded.** ✅ confirmed. `TopologyBand` (`ImpactView.tsx:170-238`) maps every upstream and downstream edge with no compact mode and no expander. Degree legend exists at line 198 — keep it.
  *Backend: aligned.* `impactEdges[].degree` and `.direction` are structural, so a compact default (direct neighbours = degree 1) is a filter, not a new field.

- **D6. CTA semantics.** ✅ confirmed at `DecisionRail.tsx:152-156`: "Continue to change plan", "Stop, do not edit", "Review receipts".
  > ⚠️ **Two corrections.**
  > 1. "Stop, do not edit" is **not** back-navigation — it calls `onRouteChange("receipts")`, routing *forward* to the same place the Change-plan CTA goes. The substantive point stands (it records nothing), but the mechanism is different from the audit's description: it is a second forward route dressed as a decision.
  > 2. Renaming "Continue to change plan" **breaks two existing assertions** — `CockpitShell.test.tsx:15` and `CockpitShell.test.tsx:73`. Budget the test update.
  >
  > Note also that `DecisionRail.tsx:143-147` documents the current two-button shape as deliberate ("One decision per view, and only Impact has one"). Changing it is a reversal of a recorded decision, not a fix to an oversight — make that explicit in the commit.

### Change plan (`ChangePlanView.tsx`)

- **D7. The reversal is prose, not structure.** ✅ premise confirmed. `firstAction()` + the "First step changed" label (`ChangePlanView.tsx:188`) is the current, weaker form. The audit's asserted values are all real, contrary to first appearance — the bundle stores them under `datahubOnlyPlan.steps[].action`, projected to `datahubOnlySteps` at `project-comparison.ts:64-65`:
  - DataHub-only first step: *"refuse to add the dbt quality check because the repository-relative source location is unknown and cannot be guessed"*
  - Joined first step: *"Add a dbt quality check for game_events … using repository-relative source `dbt/models/curated/game_events.sql` and pinned revision `59fa295c…`"*

  So **Refuse → Add quality check**, target `dbt/models/curated/game_events.sql`, revision `59fa295c` is accurate.

  > 🔴 **Backend does not align on one word: "Decision".**
  > There is no decision or disposition concept anywhere in the contract. `PlanDeltaKind` is `added | removed | reordered | constrained | uncertainty-changed` (`src/integration/plan-comparison.ts:88`), and a grep for `decision` across `src/` returns only unrelated prose comments.
  >
  > This is a ratified ruling, not just a code comment. The cockpit design contract lists "**No decision field**" among the three places the canvas was deliberately not followed: *"The canvas heads each plan panel with a decision word. Nothing records a plan's disposition … **Never call either value a decision.** A real approve/execute workflow wants a typed `planDisposition` with invariants tying it to the steps, not a display string."*
  >
  > `ChangePlanView.tsx:180-187` **refuses the same change** in code:
  >
  > > *"First step changed", not "decision changed". … nothing in the model calls either one a decision — naming them that would assert a disposition the artifact does not record, and it would put a second source of truth beside the step lists that could contradict them.*
  >
  > D7 is therefore a **contract question, not a layout question**. Two honest routes: (a) build the structured comparison using recorded vocabulary — *First planned action / Target / Revision / Reason* — which needs no contract change; or (b) add a real disposition field to the plan-comparison artifact and let the UI render it. Do not simply relabel the rows "Decision" — that is the failure mode this codebase exists to refuse.

- **D8. Full SHAs.**
  > ⚠️ **The audit has this backwards.** ~~`OutcomeBar.tsx:17` is the *only* surface that truncates~~, and it truncates correctly. `ProofIndicator.tsx` contains no truncation at all — it renders the full 40-character value inline.
  >
  > **Updated after the reduction pass:** truncation moved into `format.ts` as `shortRevision`, and three surfaces call it (`ResolvedSource`, `ContributionBand`, and `revisionLabel`'s callers). It is one implementation with three call sites rather than one surface, which is what the original finding was actually protecting: the short and long forms cannot drift apart. The full 40-character value still renders in the proof popover and in the joined plan step.
  >
  > The underlying work is still real, but restated: other surfaces currently show the **full 40-char SHA** where they should show `59fa295c` with a copy control and the full value behind disclosure. The machinery exists (`identifierMeta.copyLabel`, `type: "git-commit-sha"`, canonical value in `EvidenceValue.value`).

- **D9. Three delta cards → two grouped.** ✅ count confirmed — the bundle carries exactly 3 deltas, and the audit's grouping is coherent against them:
  | kind | label |
  |---|---|
  | `added` | use exact source `dbt/models/curated/game_events.sql` |
  | `removed` | refuse unknown source location |
  | `constrained` | constrain work to `dbt/…` at `59fa295c…` |

  Grouping `added` + `removed` into one card and `constrained` into a second is defensible.
  > 🔴 **Same "Decision" problem as D7**, plus one more: merging two contract-recorded deltas into one rendered card makes the UI assert a relationship (*these two are one change*) that the artifact does not record. If you group, union the `evidenceRefs` and keep both recorded `kind`s visible, so the grouping reads as presentation rather than as a new claim.

- **D10. Raw pointers rendered raw.** ✅ confirmed at `ChangePlanView.tsx:221`: `Evidence: {delta.evidenceRefs.join(", ")}` — renders `evidence.records[0]` literally.
  > 🔴 **Backend does not align.** This is the one delta that cannot be done with existing machinery:
  > - `planDeltaSchema.evidenceRefs` is `z.array(z.string().min(1))` — **bare strings, no `identifierMeta` slot**.
  > - The `identifierTypeSchema` enum *does* include `"evidence-path"`, and `identifier-types.ts:12` maps it to the label "Evidence location" — but **nothing anywhere produces one**. Zero assignment sites across `src/` and `apps/cockpit/src/`.
  >
  > So `evidence-path` is currently a dead enum member with a label and no producer. D10 needs an explicit decision: either extend `evidenceRefs` to carry `identifierMeta` (contract change, and gives `evidence-path` its first producer), or derive the display label in the view from the ref string (presentation-only). The second is cheaper and consistent with "derived values render, they don't go in the contract" — but then delete the unused enum member or it stays dead weight.

### Receipts (`ReceiptsView.tsx`, `cockpit.css`)

- **D11. Caveats open the route.** ✅ observation confirmed — `UnestablishedBand` renders at `ReceiptsView.tsx:156`, immediately after the route intro, before any positive result. The four values the proposed summary would assert are all real: 3 stated gaps ✅; writeback `succeeded: true`, `bothStatesRead: true`, `observation.status: "settled"` ✅; 3 plan deltas ✅.

  > 🔴 **Do not build this. It reverses a ratified ruling.** The cockpit design contract records HAC-218 as authoritative on the Receipts lead order:
  >
  > > *Receipts leads with what is not established, keeps its seven-section evidence structure, and leaves "Plan changed" to the Change plan route. The canvas leads with four outcome statements under "Result outranks limitation" — that principle governs the hero, where it was adopted, and stops there. On Receipts, unestablished evidence **is** a result, so demoting it ranks a finding beneath a summary of the findings.*
  >
  > D11 is that canvas proposal restated, down to the four outcome statements and the "Plan changed" item the ruling explicitly assigns elsewhere. The audit appears to have read the `.dc.html` canvas as governing; it does not. Reasoning is in `docs/cockpit-architecture.md`, and the ruling was re-affirmed on `feature/cockpit-ideal-state` (`6db0b21`).
  >
  > The underlying concern — the writeback, the strongest proof, sits far below the fold — is still legitimate. Address it by **raising the writeback's position or prominence within the existing seven-section structure** (which is D13's job), not by prefixing the route with an outcome summary.

- **D12. Provenance is a flat 11-row wall.** ✅ **exactly right** — `provenanceRows` (`ReceiptsView.tsx:56-72`) is precisely 11 entries. (The schema carries 12 provenance fields; `limitations` is deliberately excluded from rendering, with the reason documented at lines 68-71. Preserve that exclusion when regrouping.)
  Group into a chain: (1) subject repo + revision, (2) artifact + revision, (3) algorithm/producer, (4) digests/query details — steps 3–4 expandable.

- **D13. Writeback needs a decisive lead.** Open with "Writeback observed: DataHub accepted the enrichment and a fresh after-state read confirmed the intended state," then expand before/mutation/after/disposition.
  *Backend: aligned* — `succeeded`, `bothStatesRead`, `intendedStateObservation`, `terminalDisposition` all carried and all support the sentence.
  > Note: the bundle also records `linkOmittedBecause: "no commit-pinned source URL is available…"`. If the lead sentence claims a complete writeback, it should not swallow that stated omission.

- **D14. Audit-scale typography.** `cockpit.css` (1195 lines): raise receipt body size and line-height, reduce letter-spacing, reserve tracked uppercase eyebrows for true section boundaries.

- **D15. Bottom dead zone.** Let the footer follow content, or add: "Reproduce this exact run — Open JUDGING.md · View immutable source · Download receipt."

---

## Part 3 — Linear / process gates

| Gate | Ruling | Status | Delta |
| --- | --- | --- | --- |
| PR #70 baseline | Merge first | **Merged** ✅ verified | None |
| HAC-270 / PR #71 | Land PR | PR **merged** ✅ verified; issue In Progress | Remaining acceptance closed separately: the deployed definition is now read back and reconciled before any write, and the `already exists` swallow is gone. See `reconcileDeployedDefinition` and `test/integration/deployed-definition.test.ts` |
| HAC-145 golden fixture | Sign off and freeze | In Review | Validate deferred states, freeze |
| HAC-226 receipt binding | Close | In Progress, due 2026-08-04 | Finish binding; truth boundary for Receipts |
| HAC-150 repeated eval | Run — no n=1 causal claim | **Done** ✅ 2026-08-03, `6265f43` (#74) | 10 pairs requested, 10 observed, 0 failures. Exact source revision 10/10 joined and 0/10 DataHub-only; 5 distinct normalized step sequences DataHub-only against 1 joined. Raw outputs, aggregate and digests in `evaluation/hac-150/`, every figure with a verification command in `docs/claims.md`. The cockpit cites it rather than inferring cause from parity |
| HAC-220 polish | Hierarchy pass | In Progress | Land D3–D15 here; do not open a new design issue |
| HAC-282 judge discoverability | Finish | In Progress | ✅ **verified**: `scripts/ingest-transfermarkt-corpus.sh` exists and `JUDGING.md` mentions it **zero** times. Add the rebuild path; also fix `scripts/reproduce-hac-152-live.sh` hard-fail message |
| HAC-228 cold reads | Reinstate as bounded pre-lock gate (2 × 10 min) | Backlog | Re-prioritize; DOM assertions cannot catch status-dominance or VERIFIED misreading |
| HAC-286 Firefox flake | Capped pass: app-ready signal, failure artifacts, 10 consecutive runs | Backlog | PR #70's 57/57 does not satisfy the recorded 10-run acceptance; cap the work |
| HAC-154 video | Finish and lock | In Progress, due 2026-08-08 | Presentation gap now exceeds technical gap |
| HAC-155 submission | Final agreement + logged-out gate | Todo, due 2026-08-10 | Terminal gate |
| HAC-284 / 271 / 272 / 241 / 151 / 280 / 281 | Defer until after capture | Mostly Backlog | Hold the line; no new BETs |

> Linear statuses in this table are carried over from the audit and were **not** re-verified here; the PR and filesystem claims were.

---

## Part 4 — Updated execution order

Steps 1–2 of the audit's order are done (PR #70, PR #71 merged). Remaining:

1. ~~**D1 + D2** — reconcile hero and project narrative to the narrowed exact-source claim.~~ ✅ **done** (`e88cd3b` + Linear).
2. Close HAC-270 after reconciling its remaining acceptance items.
3. **Drop D11 and re-scope D7/D9.** Both were written against the `.dc.html` canvas as if it governed; it does not. HAC-218 rules the Receipts lead order and the design contract rules out a decision field. D11 should not be built at all; D7/D9 should be built in recorded vocabulary (*First planned action* / Target / Revision) or not at all.
4. **Decide the D10 contract question before building it** — does `evidence-path` get a producer, or get deleted? Cheapest correct answer is derive the label in the view and delete the dead enum member.
5. Sign off HAC-145; close HAC-226.
6. **D3, D4, D5, D8, D12, D13, D14, D15** under HAC-220 (hierarchy pass) — none need a contract change, and none conflict with a ruling. D13 absorbs D11's legitimate concern by raising the writeback within the existing section order.
7. ~~Run HAC-150's repeated paired evaluation.~~ **Done** in `6265f43` (2026-08-03). It was the highest-risk item on this board precisely because the causal claim would otherwise have rested on n=1; the cockpit now cites the ten-pair result instead of inferring cause from parity, and the two are deliberately kept on separate truth conditions. This row stayed marked "not started" for two days after the run, which is its own failure mode: a board asserting that the highest-risk item was skipped reads as a fabricated measurement on every surface that cites it.
8. Finish HAC-282 (JUDGING.md rebuild path + script error message).
9. Reinstate and run HAC-228's two bounded cold reads.
10. Lock HAC-154 video, then HAC-155 submission gate.
11. Freeze. No new BETs.

## Verification

- `npm test` (`vitest run && npm run test:cockpit`) green after each UI delta.
- `npm run e2e` — 57/57 cross-browser baseline must not regress; first-frame spec guards the 1280×800 fold.
- `npm run verify:judging` before declaring the HAC-282 fix done.
- `npm run typecheck` — note that vitest does not typecheck, so a broken guard can still exit 0.
- Copy changes checked against `house-copy.test.tsx`, `CockpitShell.test.tsx` and the claim ledger before editing.
