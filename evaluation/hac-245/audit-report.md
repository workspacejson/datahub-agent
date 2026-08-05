# Audit report — HAC-245: Contract and invariant adversary

> **Date:** 2026-07-31
> **Audit mode:** automated adversarial review

## Summary

Adversarial testing of the frozen `ChangeImpactEvent` 1.3, `PlanComparisonArtifact`, and `JudgeRunBundle` contracts confirms they reject all tested invalid inputs. 149/149 contract and invariant tests pass. No happy-path-only validation found — every attack vector has an explicit rejection test.

## Attacks executed

### 1. Event-digest mismatch

`validateBundle()` rejects bundles where `comparison.eventDigest` does not match `sha256` of the bundled event. Tested in `plan-comparison.test.ts`.

### 2. Unequal task/prompt/model/settings identifiers

`validateBundle()` rejects bundles where `datahubOnlyPlan.run` and `joinedPlan.run` do not share the same `RunIdentity` (model, temperature, task prompt). Tested in `plan-comparison.test.ts`.

### 3. Repository revision or DataHub snapshot mismatch

`runPairedPlan` refuses events with `workspaceArtifact.integrity !== "exact"` — tested in `paired-plan-runner.test.ts` ("refuses a source path that is not established by an exact workspace artifact").

### 4. Missing evidence references

`validateBundle()` rejects deltas with `evidenceRefs` pointing to non-existent paths in the event. Tested in `plan-comparison.test.ts`.

### 5. Placeholder leakage

`looksLikePlaceholder()` detects and rejects placeholder text in delta labels and reasons. Tested in `plan-comparison.test.ts`.

### 6. Unknown fields and malformed nested records

Zod schemas use `.strict()` on objects, rejecting unknown fields. Tested across `change-impact-event.test.ts` and `plan-comparison.test.ts`.

### 7. Invalid unavailable/empty-state substitutions

Contract validation rejects:
- `failed` or `not-queried` reads carrying counts or edges
- `absent` without `VerificationEvidence`
- `succeeded` without accepted mutations AND intended-state observation
- `noop` when before state did not match intent
- `bothStatesRead` contradicting read records

All tested in `writeback.test.ts` and `state-fixtures.test.ts`.

### 8. Writeback outcome derivation attacks

`deriveOutcome` tested against 13 attack vectors:
- stale read reported as success → **rejected**
- mutation failed but state matches → **rejected**
- no attempts at all → **rejected**
- unreadable after-state → **rejected**
- partial mutation (one of two succeeded) → **rejected**
- refusal → correctly reported as refused, not failed
- dry run → reported as unverified, not as failure

### 9. Degraded-state fixture integrity

Both fixtures validated:
- `accepted-not-observed`: mutations succeed but intended state never observed → correctly **not** reported as success
- `partial-resolution`: unresolved datasets named with reasons → accounting and code path agree

### 10. Live bundle validation

Live `JudgeRunBundle` from HAC-250's run: `validateBundle()` returns `[]` (no problems). 3 deltas, all evidence refs resolve, no placeholders.

## Test results

```
Test Files  4 passed (4)
     Tests  149 passed (149)
  Duration   2.61s
```

Full suite: **753 passed, 2 skipped** (31 test files).

## Specified-but-unbuilt items

Per HAC-146's amendment: `total` in accounting is deliberately absent (sums two denominators). Named unresolved records are unbuilt — carried by HAC-267. These are **known gaps with named owners**, not contract defects.

## Verdict

**PASS** — Contracts reject all tested adversarial inputs. No happy-path-only validation found. Every invariant in HAC-146 has a corresponding rejection test. The two specified-but-unbuilt items (accounting total, named unresolved records) are tracked in HAC-267.
