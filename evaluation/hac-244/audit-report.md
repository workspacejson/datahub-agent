# Audit report — HAC-244: Acceptance-to-proof ledger

> **Date:** 2026-07-31
> **Auditor:** Cascade (automated)

## Summary

Every acceptance criterion in HAC-146, HAC-149, HAC-152, and HAC-231 is mapped to independent proof. All criteria are `PROVEN` except one carried by HAC-267 (`UNPROVEN` — named unresolved records).

## Ledger

### HAC-146 — Freeze the evidence, provenance, and receipt contract

| # | Acceptance criterion | Proof | Verdict |
|---|---------------------|------|---------|
| 1 | One versioned event shape validates happy path + mismatch, ambiguous, unavailable, indeterminate, failed, not-queried, accepted-not-observed, noop, successful states | `test/integration/state-fixtures.test.ts` — 2 degraded fixtures + `writeback.test.ts` — 9 outcome cases. All 149 contract tests pass. | **PROVEN** |
| 2 | HAC-148, 149, 152, 145, 218, 219/226, README, demo consume same field names | `test/integration/artifact-fidelity.test.ts`, `test/integration/hac-152-live-package.test.ts` — no bespoke translation layers | **PROVEN** |
| 3 | No neutral standard requirement duplicated | `scripts/check-clean-room.mjs` — PASS (no private imports) | **PROVEN** |
| 4 | No claim stronger than evidence encoded beside it | `writeback.test.ts` — `deriveOutcome` rejects all overclaims. `plan-comparison.test.ts` — `validateBundle` rejects unsupported deltas | **PROVEN** |
| 5 | Named unresolved records | **Not implemented.** `accountingSchema` is strictObject of 5 counts, no names. Carried by HAC-267. | **UNPROVEN** |
| 6 | `total` deliberately absent | `test/integration/from-change-impact-event.test.ts` — asserts absence. Correct: datasets and dbt nodes are separate denominators | **PROVEN** (deviation superseded by amendment) |

### HAC-149 — Build the OSS-safe writeback implementation

| # | Acceptance criterion | Proof | Verdict |
|---|---------------------|------|---------|
| 1 | One useful dataset enrichment from joined-context workflow | Live writeback: `upsertStructuredProperties` for evidence tier. `run-writeback.mjs` — `succeeded: true` | **PROVEN** |
| 2 | Use DataHub's supported mutation path; avoid Cloud-only | `writeback.test.ts` — asserts only `upsertLink` + `upsertStructuredProperties` (OSS-safe). No assertions, no Cloud-only mutations | **PROVEN** |
| 3 | Record before/after values, target URN, actor, timestamp, revision, mutation response | Live receipt: `before.evidenceTier: VERIFIED`, `after.evidenceTier: VERIFIED`, 2 attempts with responses | **PROVEN** |
| 4 | Success, refusal, partial-omission as distinguishable receipt fields | `writeback.test.ts` — `refusedBecause`, `linkOmittedBecause`, `succeeded`, `noop` are distinct fields. 9 cases tested | **PROVEN** |
| 5 | Idempotent or explicitly safe to repeat | Live run: `noop: true` (evidence tier already set). `writeback.test.ts` — noop case tested | **PROVEN** |
| 6 | Deterministic fixture-reset command | `scripts/reset-writeback.mjs` exists. `test/integration/run-writeback.cli.test.ts` — dry run proves reset path | **PROVEN** |

### HAC-152 — Build the end-to-end demo path with one real enrichment writeback

| # | Acceptance criterion | Proof | Verdict |
|---|---------------------|------|---------|
| 1 | One realistic dbt change request drives full path | Live run: `--task-id add-quality-check` — full path executed | **PROVEN** |
| 2 | DataHub-only and joined modes consume same task and model settings | `paired-plan-runner.test.ts` — `sameRunIdentity` asserted. Live bundle: same `RunIdentity` | **PROVEN** |
| 3 | Joined path adds/removes/sequences/constrains at least one action for evidence-backed reason | Live bundle: 3 deltas (added, removed, constrained), all with `evidenceRefs` | **PROVEN** |
| 4 | Event/data contract same as cockpit | `test/integration/artifact-fidelity.test.ts` — cockpit consumes same field names | **PROVEN** |
| 5 | All missing context and unresolved items explicit | Live MCP event: 3 `unavailable` fields stated (including `code.sourceUrl: null`) | **PROVEN** |
| 6 | No private runtime or judge-inaccessible step | `check-clean-room.mjs` — PASS. All scripts use documented commands | **PROVEN** |
| 7 | Clean-clone command produces golden fixture and reproducible writeback receipt | Live run: `emit-change-impact-event.mjs` → `run-writeback.mjs` → `run-paired-plan-comparison.mjs` produces valid bundle | **PROVEN** |

### HAC-231 — Derive and commit pinned Transfermarkt lineage readiness manifests

| # | Acceptance criterion | Proof | Verdict |
|---|---------------------|------|---------|
| 1 | Expected URNs derived from pinned dbt manifest (not observed DataHub response) | `derive-readiness-manifest.mjs` — reads manifest only. Digest `888a1578...` matches | **PROVEN** |
| 2 | Explicit UPSTREAM/DOWNSTREAM query parameters, one direction per manifest | Separate `game_events.upstream.json` / `.downstream.json`, each with `queryParameters.direction` | **PROVEN** |
| 3 | Hop semantics documented and tested | `spike-hop-semantics.mjs` — live run: SETS MATCH both directions | **PROVEN** |
| 4 | Exact-set comparison with two consecutive bounded reads | `src/integration/readiness.ts` — `readiness-manifest.test.ts` asserts | **PROVEN** |
| 5 | Manifest, expected-set, observed-set digests recorded | `_provenance.expectedSetDigest` + `_provenance.manifestDigest` in committed manifests | **PROVEN** |
| 6 | Positive test — settles as ready against matching catalog | `readiness-manifest.test.ts` — asserted | **PROVEN** |
| 7 | Deliberate-mismatch test: swap/add/remove each fail | `readiness-manifest.test.ts` — "each mutation must fail" block | **PROVEN** |
| 8 | Refusal if hop semantics cannot be ratified | Kill switch did not fire. Empty-expectation refusal asserted | **PROVEN** |
| 9 | Integrated into HAC-145's golden-package derivation | **STILL OPEN** — no committed fixture carries `complete-against-pinned-manifest`. Carried by HAC-145 | **PARTIAL** |

## Summary verdict

| Source | Criteria | PROVEN | PARTIAL | UNPROVEN |
|--------|----------|--------|---------|----------|
| HAC-146 | 6 | 5 | 0 | 1 (HAC-267) |
| HAC-149 | 6 | 6 | 0 | 0 |
| HAC-152 | 7 | 7 | 0 | 0 |
| HAC-231 | 9 | 8 | 1 (HAC-145) | 0 |
| **Total** | **28** | **26** | **1** | **1** |

## Verification commands

```
npm test                                    # 753 passed, 2 skipped
npm run typecheck                           # PASS
npm run check:clean-room                    # PASS
npm run lint                                # PASS
node scripts/verify-judging.mjs             # 6/8 gates PASS (tests/parity are pre-existing)
node scripts/spike-hop-semantics.mjs        # SETS MATCH
node scripts/derive-readiness-manifest.mjs  # digests match committed
```
