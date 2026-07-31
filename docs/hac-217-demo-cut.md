# HAC-217 cockpit UX ratification and demo cut

> **Type:** Reference | **Status:** Current | **Scope:** Cockpit UX demo cut

**Status:** ratified for implementation handoff on 2026-07-27.  The attached
**Cockpit UX reference layout** on HAC-217
is the canonical visual artifact.  This document is the authoritative
ship/defer ledger for it; it does not introduce a second wireframe, route, or
application shell.

## Freeze boundary

The following are frozen: the three-view sequence (**Impact → Change plan →
Receipts**), five-second thesis, `Review changed plan` CTA, text-first source
tags, and the explicit degraded-state grammar.  The light annotation canvas,
callouts, and review notes in the attachment are not application chrome.

This is deliberately not an evidence contract.  Counts, URNs, names, exact
paths, revisions, writeback outcomes, and the final hero sentence remain
provisional until HAC-225, HAC-146, and HAC-145 converge.  In particular,
`DataHub found the model. workspace.json made it actionable.` is not approved
for a judge-facing hero unless HAC-225 proves the corpus-matched, exact-path
resolution delta.  Until then components may receive values only from the
centralized provisional adapter owned by HAC-224, which must surface `DESIGN
PLACEHOLDER · NOT OBSERVED DATA` automatically.

## Ship/defer ledger

`Demo ship` means it belongs in the 60-second demo cut. `Designed/deferred`
means the canonical design remains valid but is intentionally outside that cut;
it is not permission to silently omit the state from the production model.

| Frame/state | Demo ship | Designed/deferred | Reason | Implementation owner | Evidence gate |
| --- | --- | --- | --- | --- | --- |
| Reading rules / source and status vocabulary | No | Yes | It is review scaffolding, not a judge-facing application frame. Its rules are implemented as component semantics rather than a separate route. | HAC-224 | Source tags, provisional banner, and non-success semantics have automated UI invariant coverage. |
| Impact / five-second frame | Yes | No | Establishes the thesis, source distinction, and single next action before detail. | HAC-218 on the HAC-224 shell | HAC-225 provides corpus-safe, exact-path evidence; until then all claims are visibly provisional. Two cold-reader observations confirm thesis, source distinction, and CTA within five seconds. |
| Change plan / DataHub-only versus Joined delta | Yes | No | This is the causal hero: the normalized semantic plan delta, not raw JSON, explains why joined context matters. | HAC-218 | HAC-225 proves or refuses the corpus-matched delta. HAC-146 binds fields. If ambiguous, show the narrowed fallback rather than an invented win. |
| Receipts / accounting, provenance, writeback, limitations | Yes | No | The demo must distinguish resolution, mutation, and observation and leave the proof trail inspectable. | HAC-219 | HAC-146 binds receipt fields and HAC-226 binds real evidence. Provisional mode never presents success or verification. |
| No declared lineage returned | No | Yes | Honest zero is valuable but cannot be asserted from an empty response in the short cut. | HAC-224, with HAC-218 content contract | A completeness proof establishes that lineage was queried and none was declared; empty arrays alone are insufficient. |
| Not queried / unavailable | No | Yes | It is distinct from both zero and failure, but does not advance the 60-second narrative. | HAC-224 | Adapter distinguishes unavailable/not queried from an observed empty result and supplies an actionable recovery reason. |
| Contradictory DataHub and workspace.json evidence | No | Yes | A join cannot select a preferred source when independently scoped DataHub and workspace.json evidence disagree. The contradiction is an explicit trust state, not a partial success or an empty result. | HAC-225 establishes the evidence disposition; HAC-224 renders the blocked state | Evidence identifies the same target, pinned repository revision, and exact path for both claims, records the conflicting fields, withholds the joined claim, and provides a reconciliation path. |
| Source or revision cannot be safely anchored / repository revision mismatch | No | Yes | **Explicit defer decision:** preserve the refusal state for production, but keep it out of the timed hero because it blocks the workspace-derived claim rather than demonstrating its value. It must never fall through to a joined success. | HAC-225 owns artifact/revision integrity; HAC-224 renders the refusal | HAC-225 verifies the selected corpus artifact, repository identity, revision, and exact path. A mismatch renders no workspace-derived claim. |
| Partial resolution with every unresolved item named | Yes | No | Mandatory honesty state: it demonstrates a useful but bounded result without hiding residual uncertainty. | HAC-218 on the HAC-224 shell | Resolution accounting names each unresolved item and establishes the candidate/manifest scope; counts alone do not pass. |
| Mutation accepted; intended state not observed | Yes | No | Mandatory terminal state: acceptance is not success, and the distinction is central to the trust surface. | HAC-219 | HAC-223-compatible receipt contains mutation acknowledgement plus a separately missing intended-state observation and recovery path. |
| Failed / blocking evidence state | No | Yes | The production cockpit needs a legible blocked state, but it would dilute the required positive-path and mandatory-risk cut. | HAC-224, with the owning lane supplying domain-specific recovery copy | A typed failure identifies reason, affected claim, what remains usable, and a recovery path; it cannot be inferred from transport failure alone. |
| Connection lost mid-run | No | Yes | A transport loss after a run begins is neither an observed empty result nor proof that prior partial data remains complete. It must preserve the last known scope without promoting it to a finished claim. | HAC-224 renders run state; HAC-225 owns evidence-scope recovery | The run records its last successful observation boundary, marks subsequent results indeterminate, names any unresolved scope, and provides an explicit retry or recovery path. |
| Source found without workspace.json | No | Yes | It is an important degradation of the join, but is neither the three-view story nor a proof of the delta. | HAC-225 decides evidence disposition; HAC-224 renders it | HAC-225 confirms the source/artifact exists and confirms workspace.json is absent or unavailable at the pinned revision. No workspace-derived data is rendered. |
| Lineage found without an actionable repository source | No | Yes | It preserves the distinction between catalog lineage and actionable repository evidence, but is outside the timed story. | HAC-225 decides evidence disposition; HAC-224 renders it | HAC-225 confirms lineage scope and proves that no safely anchored, actionable repository source was resolved. No joined-plan claim is rendered. |

## Handoff rules

- HAC-218 and HAC-219 implement only their assigned shipped surfaces; neither
  reopens product strategy or creates a competing visual hierarchy.
- HAC-224 owns the shell, one `CockpitViewModel` boundary, provisional-data
  adapter, and automatic placeholder warning. Components consume no raw
  evidence values.
- A judge/production build rejects placeholder mode. A development placeholder
  is an epistemic warning, not a successful demo state.
- React Flow stays excluded. A static accessible impact rail is the baseline;
  admission requires a recorded comprehension failure under HAC-224's gate.
- Every unresolved item is explicitly named with a restrained open/dashed
  boundary. Provenance is shown independently from confidence, completeness,
  and disposition.

## Ratification verification

The check at `test/docs/hac-217-demo-cut.test.ts` deliberately fails if a
required frame/state disappears, if a mandatory demo state is changed to
deferred, if the revision-mismatch decision is absent, or if this UX ledger
approves the evidence-dependent hero sentence. It is a documentation-contract
test, not a claim that the UI or final evidence has landed.

## Deferral: HAC-262 demo ledger

The demo ledger ratification (HAC-262) is **formally deferred** to the
pre-submission re-verification pass. The test at `test/docs/hac-217-demo-cut.test.ts`
passes and verifies the ledger's structural integrity, but the full demo
evidence package has not been produced against fresh infrastructure. This
deferral is recorded in the annotated tag `v0.0.1-hac-259` and in the Linear
comment on HAC-262.
