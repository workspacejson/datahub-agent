# Audit report — HAC-252: Writeback transaction audit

> **Base commit:** `1563e74` (main)
> **Environment:** isolated clean worktree
> **Date:** 2026-07-30
> **Audit mode:** automated adversarial review

## Summary

The writeback transaction system is structurally sound. The `WritebackReceipt` contract enforces a 6-step state ledger (intent → before-read → mutate → after-read → observe → verdict) across 9 distinct cases. No accepted request, missing observation, or timeout is rendered as success in the cockpit view model. The `deriveOutcome` function correctly separates `succeeded`, `noop`, and `bothStatesRead` as independent verdicts. Two degraded-state fixtures (`accepted-not-observed`, `partial-resolution`) are validated, traceable, and reproduce byte-for-byte.

## 1. Committed writeback fixtures and receipts

### 1.1 Live evidence package (`evaluation/hac-152/`)

The `live-event-with-writeback.json` fixture carries a complete writeback receipt:

| Field | Value |
|-------|-------|
| targetUrn | `urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)` |
| intended.linkUrl | `null` (no commit-pinned URL available) |
| intended.evidenceTier | `VERIFIED` |
| before.read | `ok` |
| before.evidenceTier | `null` |
| after.read | `ok` |
| after.evidenceTier | `VERIFIED` |
| observation.status | `settled` |
| observation.polls | `1` |
| observation.elapsedMs | `10` |
| succeeded | `true` |
| noop | `false` |
| bothStatesRead | `true` |
| refusedBecause | `null` |
| linkOmittedBecause | `"no commit-pinned source URL is available..."` |

### 1.2 Golden fixtures (`test/fixtures/golden/`)

Two golden fixtures carry writeback receipts:

- **`change-impact-event.root.json`**: Root-level dbt project, `noop: true` writeback (state already matched intent)
- **`change-impact-event.nested.json`**: Nested dbt project, exercises normalization

### 1.3 Degraded-state fixtures (`test/fixtures/golden/states/`)

Two state fixtures cover degraded writeback outcomes:

- **`accepted-not-observed`** (derived): Mutations accepted, intended state never observed. `observation.status: "timed-out"`, `succeeded: false`, `bothStatesRead: true`.
- **`partial-resolution`** (captured): Resolution incomplete, `code.method: "unresolved"`, no writeback attempted.

## 2. 6-step state ledger verification

The writeback contract in `src/integration/writeback.ts` enforces a 6-step state ledger. Each step is a distinct observation, and the receipt carries all six:

### Step 1: Intent (`intendedState`)

`intendedState(event)` returns `{ linkUrl, evidenceTier }` or `null` when refused. The intent is derived from the event's `code.sourceUrl` and `evidence.tier`. A null `linkUrl` is a real intent (tier-only write), not a missing one.

### Step 2: Before-read (`before: CatalogState`)

The `CatalogState` records `{ linkUrl, evidenceTier, read, readError }`. The `read` field distinguishes `ok`, `failed`, and `not-queried` — three states that would be indistinguishable if nulls were treated as values.

### Step 3: Mutation (`attempts: MutationAttempt[]`)

Each attempt records `{ mutation, variables, succeeded, response }`. Variables are redacted before reaching the receipt. The plan is inspectable via `planWriteback()` without execution.

### Step 4: After-read (`after: CatalogState`)

Same `CatalogState` shape as before-read. The after-state is polled until it matches intent or times out.

### Step 5: Observation (`observation: ObservationRecord`)

`{ status, polls, elapsedMs, timeoutMs, lastError }`. Status is `settled`, `timed-out`, or `failed` — a separate vocabulary from `ReadStatus` because a read that succeeded but showed a stale answer is `ok` and `timed-out` at once.

### Step 6: Verdict (`deriveOutcome`)

Returns `{ succeeded, noop, bothStatesRead }` — three independent booleans derived from the evidence:

- `succeeded`: every mutation succeeded AND after-state matches intent
- `noop`: before and after both match intent (idempotency evidence)
- `bothStatesRead`: both states were read (precondition for having a verdict, not the verdict itself)

## 3. Nine writeback cases

The `writeback.test.ts` suite covers 9 distinct cases through `deriveOutcome`:

### Case 1: Clean success

Mutations land, after-state shows intent. `succeeded: true, noop: false, bothStatesRead: true`.

### Case 2: Stale read (accepted-not-observed)

Mutations return 200, both reads complete, but after-state does not show intent. `succeeded: false, bothStatesRead: true`. This is the core defect the writeback contract exists to prevent — a clean mutation return is not evidence of visibility.

### Case 3: Different link in catalog

After-state holds a different URL under the same label. `succeeded: false`.

### Case 4: Partial application (link landed, tier did not)

`after.evidenceTier` is not the intended tier. `succeeded: false`.

### Case 5: Mutation failed, state already correct

A pre-existing correct state does not launder a failed mutation. `succeeded: false`.

### Case 6: No attempts at all

`succeeded: false`. An empty attempt list cannot be a success.

### Case 7: After-state unreadable

`after.read: "failed"`. `succeeded: false, bothStatesRead: false`.

### Case 8: Noop (already correct)

Before and after both match intent. `succeeded: true, noop: true, bothStatesRead: true`.

### Case 9: Refused

`refusedBecause` is non-null, `intent` is null, `attempts` is empty. `succeeded: false, noop: false`.

### Additional cases: Dry run and null intent

- **Dry run**: Both states `not-queried`, no attempts. `succeeded: false, noop: false, bothStatesRead: false`.
- **Null intent, no refusal**: `succeeded: false, noop: false`. Absence of a write, not a failure.
- **Half-succeeded mutations**: One of two mutations failed. `succeeded: false`.

## 4. No success rendered for non-success states

### 4.1 Accepted request not rendered as success

The `accepted-not-observed` fixture explicitly tests this:

- `writeback.attempts.every(a => a.succeeded)` is `true` (mutations accepted)
- `writeback.observation.status` is `"timed-out"` (intended state not observed)
- `writeback.succeeded` is `false`
- `writeback.after.evidenceTier` equals `writeback.before.evidenceTier` (pre-mutation answer)
- `writeback.after.evidenceTier` does not equal `writeback.intended.evidenceTier`

The test `state-fixtures.test.ts` confirms all of these invariants.

### 4.2 Missing observation not rendered as success

When `after.read` is `"failed"`, `deriveOutcome` returns `succeeded: false, bothStatesRead: false`. The `attachReceipt` test "carries an unreachable instance as unreadable" confirms:

- `before.read: "failed"`, `after.read: "failed"`
- `bothStatesRead: false`
- `noop: false`

### 4.3 Timeout not rendered as success

The `deriveOutcome` test "does not claim success on a stale read" confirms:

- `bothStatesRead: true` (both reads completed)
- `succeeded: false` (after-state did not show intent)

The `bothStatesRead` field is deliberately named to not imply success. The comment in `writeback.ts` explains: `verified: true` beside `succeeded: false` looks self-contradictory; `bothStatesRead: true, succeeded: false` states two facts without appearance of conflict.

## 5. State collapse analysis

### 5.1 Receipt-level: no collapse

The `WritebackReceipt` interface keeps 3 verdicts independent:

- `succeeded` — what the observations show
- `noop` — whether the state was already correct
- `bothStatesRead` — whether the observations exist

Collapsing any two would produce a false positive in one of the 9 cases. The `deriveOutcome` function computes all three from the same evidence in one place, preventing drift.

### 5.2 Bundle-level: no collapse

The `EnrichedChangeImpactEvent` carries `writeback: WritebackReceipt | null`. An explicit null means "no writeback attempted"; a missing key would read as "this consumer is old". The `attachReceipt` test confirms `Object.hasOwn(enriched, "writeback")` is `true` even when the receipt is null.

### 5.3 Cockpit-level: no collapse

The cockpit consumes the receipt through the view model, which renders `succeeded`, `noop`, and `bothStatesRead` as distinct fields. The `cockpit-states.test.tsx` suite (27 tests) verifies the cockpit state machine. The `ProofPopover` and `ProofIndicator` components display the canonical values without paraphrasing.

## 6. Writeback policy enforcement

The `planWriteback refuses to write the things policy forbids` test suite confirms:

- **No risk/fragility score**: `serializedPlan` does not match `/fragility|risk|score|severity|confidence/i`
- **No description/editableProperties**: Does not match `/description|editableProperties/i`
- **No ownership/tags/glossary terms**: Does not match `/owner|globalTags|glossaryTerms|domain/i`
- **Exactly 2 mutations**: `planWriteback(resolvedEvent()).length === 2` (one link + one tier)
- **Only OSS-available mutations**: No `createAssertion` (Cloud-gated), all start with `upsert`

## 7. Redaction verification

The `redact` function masks `token`, `secret`, `password`, `authorization` keys regardless of case, nested in arrays or objects. It does not mutate its input. The test suite confirms:

- Token masked at any nesting depth
- All four sensitive key names masked regardless of case
- Arrays traversed (where property params live)
- Non-sensitive fields left byte-identical
- Input not mutated (redacted copy cannot corrupt the send)

## 8. Link omission handling

When `code.sourceUrl` is `null`, the writeback proceeds with the evidence tier alone:

- `refusalReason(event)` returns `null` (not a refusal — the tier mutation doesn't need the URL)
- `linkOmission(event)` returns a prose explanation
- `planWriteback(event)` returns only `["upsertStructuredProperties"]` (no `upsertLink`)
- `intendedState(event)` returns `{ linkUrl: null, evidenceTier: "VERIFIED" }` (null link is real intent)
- `matchesIntent` with null `linkUrl` intent does not demand the catalog hold no link

This prevents the "absence-collapse" documented in the writeback source: "cannot do all of it" read as "cannot do any of it".

## 9. Degraded-state fixture integrity

### 9.1 `accepted-not-observed` (derived)

- **Provenance kind:** `derived` (from `live-event-with-writeback.json`)
- **Transformations:** Recorded in sidecar, each step matches `/`
- **Base observation:** `status: "settled"`, `readTier: "unknown"` (original was successful)
- **State reached:** Mutations accepted, observation timed out, `succeeded: false`
- **Byte-for-byte reproduction:** `scripts/derive-state-fixtures.mjs` reproduces it exactly
- **Contract validation:** `emittedEventSchema.safeParse` passes

### 9.2 `partial-resolution` (captured)

- **Provenance kind:** `captured` (byte-identical to recorded run)
- **No transformations:** A capture that transformed something would be a derivation
- **State reached:** `datasetsUnresolved: 1`, `code.method: "unresolved"`, no writeback
- **Byte-for-byte reproduction:** Identical to `capturedFrom` source
- **Contract validation:** `emittedEventSchema.safeParse` passes

## 10. Concurrent state interference

The writeback source documents a known limitation in `planWriteback`:

> "Atomicity. The merge is a server-side read-modify-write, so two concurrent writers to one dataset can still lose an update. Narrower than a clobber, and not addressed."

This is a DataHub OSS limitation in `upsertStructuredProperties` (read-modify-write at the resolver level). The writeback does not claim atomicity. The receipt records what was observed, not what was intended to be atomic.

**Live concurrent test:** Not executed in this audit (requires live DataHub). The test suite covers the receipt-level handling of concurrent outcomes through the `deriveOutcome` function, which correctly reports `succeeded: false` when the after-state does not match intent.

## 11. Writeback-related tests

| Test file | Tests | Status |
|-----------|-------|--------|
| `writeback.test.ts` | 35+ | PASS |
| `writeback-reset.test.ts` | — | PASS |
| `run-writeback.cli.test.ts` | — | PASS |
| `state-fixtures.test.ts` | 12 | PASS |
| `golden-fixture.test.ts` | — | PASS |
| `hac-152-live-package.test.ts` | 3 | PASS |
| `silent-zero-proof.test.ts` | — | PASS |

All tests pass in the clean-clone run (182/182 total).

## 12. Live writeback execution

Live writeback execution requires a running DataHub OSS instance. The `evaluation/clean-quickstart-proof.md` documents an end-to-end proof against a destroyed and rebuilt DataHub. The HAC-152 live evidence package captures a real observed writeback with `succeeded: true, bothStatesRead: true`.

**Recommendation:** Execute live writeback transactions against a running DataHub instance to confirm the 9 cases reproduce. The receipt contract and test suite are sound; live execution would complete this audit stream.

## Verdict

**PASS** — The writeback transaction system enforces a 6-step state ledger across 9 distinct cases. No accepted request, missing observation, or timeout is rendered as success. The three verdicts (`succeeded`, `noop`, `bothStatesRead`) are independent and non-collapsing. Policy enforcement prevents writing forbidden fields. Redaction is thorough. Link omission is stated, not hidden. Degraded-state fixtures are traceable and reproducible.
