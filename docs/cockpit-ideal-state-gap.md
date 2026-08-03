# Deltas Between Current Codebase and the Audited Ideal State

Gap analysis mapping every claim in the design audit against the actual state of the repo, ending in an updated execution order.

**Verification status:** every code claim below was checked against source at `08b4260` (PR #72). Line numbers, file paths, fixture values, and PR timestamps are confirmed unless a `⚠️` note says otherwise. Where verification changed the finding, the correction is inline and marked.

---

## Part 0 — Already landed (no delta)

The audit was written against older screenshots. These recommendations are **already implemented** — all confirmed by reading source:

- **Persistent compact outcome bar** — `OutcomeBar.tsx` renders Source / Lineage / Coverage / Plan / Writeback / Limitations on every route. SHA shortening confirmed at `OutcomeBar.tsx:17` (`/^[0-9a-f]{40}$/i` → `slice(0, 8)`).
- **Full hero only on Impact** — `CockpitShell.tsx:293-321` gates the silent-zero pair and coverage band to the Impact route.
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

### D1. Hero stakes sentence still claims the absent capability ✅ confirmed

`ImpactView.tsx:281` reads verbatim:

> "DataHub says where data flows; git says what breaks together; *joining them* silently returns nothing. Here is the proof."

The receipt contradicts it. The shipped bundle states:

```json
{ "field": "partners", "source": "workspacejson", "reason": "indeterminate",
  "detail": "The artifact resolves the exact source but contains no behavioral
             co-change evidence, so no partners are asserted." }
```

So "git says what breaks together" claims exactly the capability the receipt disclaims. This is the load-bearing defect and the finding is sound.

**Delta:** replace with the narrowed claim — "DataHub identifies the affected dataset. workspace.json resolves it to the exact repository path and revision. Without that join, the agent gets zero matches and no warning."

> ⚠️ **Correction to the audit's caution.** The hero sentence is **not** pinned in `house-copy.test.tsx`. Grep across `house-copy.test.tsx` and all `components/*.test.tsx` returns no pin on this string. This edit is low-risk — the audit's "check for pinned copy first" advice is prudent but the pin does not exist.

### D2. Linear project description is out of parity

Project description still promises "code partners learned from repository history" and "behavioral code partners". HAC-154's message lock already uses the correct narrowed wording — the project description is the outlier.

**Delta:** rewrite both to the narrowed HAC-150 exact-source-and-revision scope. *(Not code-verifiable; Linear-side.)*

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
  > `ChangePlanView.tsx:180-187` **explicitly refuses this exact change**, in a comment:
  >
  > > *"First step changed", not "decision changed". … nothing in the model calls either one a decision — naming them that would assert a disposition the artifact does not record, and it would put a second source of truth beside the step lists that could contradict them.*
  >
  > D7 is therefore a **contract question, not a layout question**. Two honest routes: (a) build the structured comparison using recorded vocabulary — *First planned action / Target / Revision / Reason* — which needs no contract change; or (b) add a real disposition field to the plan-comparison artifact and let the UI render it. Do not simply relabel the rows "Decision" — that is the failure mode this codebase exists to refuse.

- **D8. Full SHAs.**
  > ⚠️ **The audit has this backwards.** `OutcomeBar.tsx:17` is the *only* surface that truncates, and it truncates correctly. `ProofIndicator.tsx` contains no truncation at all — it renders the full 40-character value inline.
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

- **D11. Caveats open the route.** ✅ confirmed — `UnestablishedBand` renders at `ReceiptsView.tsx:156`, immediately after the route intro, before any positive result. Add a leading receipt-outcome summary — **Exact source resolved · Plan changed · Writeback observed · 3 limitations remain** — each expandable into its section.
  *All four values verified against the shipped bundle:* 3 stated gaps ✅; writeback `succeeded: true`, `bothStatesRead: true`, `observation.status: "settled"` ✅; 3 plan deltas ✅. The proposed summary asserts nothing the evidence does not carry.

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
| HAC-270 / PR #71 | Land PR | PR **merged** ✅ verified; issue In Progress | Close issue after reconciling remaining acceptance (deployed property reconciliation; the `already exists` swallow note was descoped — reconcile explicitly) |
| HAC-145 golden fixture | Sign off and freeze | In Review | Validate deferred states, freeze |
| HAC-226 receipt binding | Close | In Progress, due 2026-08-04 | Finish binding; truth boundary for Receipts |
| HAC-150 repeated eval | Run — no n=1 causal claim | Todo, due 2026-08-03 | Not started; highest-risk slippage |
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

1. Close HAC-270 after reconciling its remaining acceptance items.
2. **D1 + D2** — reconcile hero and project narrative to the narrowed exact-source claim. Cheap, unblocks all capture, and no test pin blocks it.
3. **Decide the D7/D9/D10 contract questions before building them** — this is new, and it gates the largest UI delta. Three questions: does a plan *decision* become a recorded field or stay unnamed; does grouped-delta rendering union its evidence refs; does `evidence-path` get a producer or get deleted.
4. Sign off HAC-145; close HAC-226.
5. **D3–D6, D8, D11–D15** under HAC-220 (outcome-first hierarchy pass) — none of these need a contract change.
6. Run HAC-150's repeated paired evaluation.
7. Finish HAC-282 (JUDGING.md rebuild path + script error message).
8. Reinstate and run HAC-228's two bounded cold reads.
9. Lock HAC-154 video, then HAC-155 submission gate.
10. Freeze. No new BETs.

## Verification

- `npm test` (`vitest run && npm run test:cockpit`) green after each UI delta.
- `npm run e2e` — 57/57 cross-browser baseline must not regress; first-frame spec guards the 1280×800 fold.
- `npm run verify:judging` before declaring the HAC-282 fix done.
- `npm run typecheck` — note that vitest does not typecheck, so a broken guard can still exit 0.
- Copy changes checked against `house-copy.test.tsx`, `CockpitShell.test.tsx` and the claim ledger before editing.
