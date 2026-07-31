# Audit report — HAC-249: Clean-clone reproducibility

> **Branch:** `audit/hac-249-clean-clone-repro`
> **Base commit:** `1563e74` (main)
> **Worktree:** `/Users/user1/Documents/hackathons/audit-wt-06`
> **Date:** 2026-07-30
> **Auditor:** Cascade (automated)

## Summary

A clean clone of `datahub-agent` at commit `1563e74` builds, type-checks, lints, and passes all tests from a cold start using only published npm packages. No hidden prerequisites, local links, or unpublished tarballs were found. The clean-room import rule passes. The parity gate is correctly skipped without `PARITY_OLD_SIDE`.

## Environment

| Item | Value |
|------|-------|
| Node | v22.19.0 |
| npm | 10.9.8 |
| OS | macOS |
| Commit | `1563e74` |
| Install | `npm ci` (from clean lockfile) |

## Cold-start ledger

### R1: Install (`npm ci`)

- **Status:** PASS
- **Duration:** ~45s
- **Lockfile:** `package-lock.json` (lockfileVersion 3)
- **Dependencies:** 629 resolved packages
- **Hidden prerequisites:** None found. All dependencies resolve to published npm registry versions.
- **Local links / private tarballs:** None. `package.json` declares only `@workspacejson/cli` (0.5.0) and `@workspacejson/spec` (0.4.4) as workspace-scoped, both published.

### R2: Build (`npm run build`)

- **Status:** PASS
- **Output:** TypeScript compilation + Vite production build for cockpit
- **Artifacts:** `dist/` (root), `apps/cockpit/dist/`
- **Undocumented build steps:** None. `tsc --noEmit` + `vite build` is the complete build chain.

### R3: Typecheck (`npm run typecheck`)

- **Status:** PASS
- **Scope:** `tsc --noEmit` for root + `tsc --noEmit -p tsconfig.json` for cockpit workspace
- **Errors:** 0

### R4: Lint (`npm run lint`)

- **Status:** PASS
- **Scope:** `biome lint --error-on-warnings` over 21 files
- **Warnings:** 0, **Errors:** 0

### R5: Clean-room import rule (`npm run check:clean-room`)

- **Status:** PASS
- **Controlled dependencies:** `@workspacejson/cli` 0.5.0, `@workspacejson/spec` 0.4.4
- **Result:** Every dependency resolves to a published registry version. No source-level imports from the parent platform.

### R6: Tests (`npm test`)

- **Status:** PASS
- **Test files:** 17 passed (17)
- **Tests:** 182 passed (182)
- **Duration:** 12.30s
- **Failures:** 0
- **Skipped:** 0

### R7: Cockpit tests (`npm run test --workspace=@workspacejson/cockpit`)

- **Status:** PASS (included in R6 — 17 test files include cockpit suite)
- **Cockpit-specific tests:** `CockpitShell`, `ImpactFrame`, `ImpactChangePlan`, `ProofPopover`, `ProofIndicator`, `App`, `cockpit-states`, `house-copy`, `vocabulary-surface`

### R8: Judging verification (`npm run verify:judging`)

- **Status:** PASS (all required gates)
- **Gates:**

| Gate | Status | Detail |
|------|--------|--------|
| typecheck | PASS | exit 0 |
| lint | PASS | exit 0 |
| clean-room | PASS | exit 0 |
| tests | PASS | exit 0 |
| cockpit-tests | PASS | exit 0 |
| production-build | PASS | exit 0 |
| parity | SKIP | set `PARITY_OLD_SIDE` or provide `.parity-cache/` to run |

### R9: Parity gate (`npm run parity:datahub-adapter`)

- **Status:** SKIP (by design)
- **Reason:** Requires `PARITY_OLD_SIDE` env var or `.parity-cache/` directory. This is documented in `migration/parity-datahub-shim.mjs` and `docs/adopter-contract.md`. The skip is correct behavior — the gate validates adapter parity against a frozen migration baseline that must be fetched separately.

## Dependency audit

### Published package verification

All dependencies in `package.json` were verified against the npm registry through `npm ci`:

- **Production dependencies:** `@workspacejson/cli@0.5.0`, `@workspacejson/spec@0.4.4` — both published
- **Dev dependencies:** `typescript`, `vitest`, `vite`, `react`, `biome`, `playwright` — all published
- **No `file:` or `link:` references** in `package.json` or `package-lock.json`
- **No git URLs** as dependency specifiers
- **No unpublished tarballs**

### Clean-room boundary

The clean-room import rule (`docs/clean-room.md`) is enforced by `scripts/check-clean-room.mjs`:
- Scans `package.json` and `package-lock.json`
- Identifies `@workspacejson/*` scoped packages as controlled
- Verifies each resolves to a published registry version
- **Result:** PASS — 629 packages, 2 controlled, all published

## Documented procedure audit

### README quickstart

The README documents:
1. `npm ci` — matches actual install
2. `npm test` — matches actual test command
3. `npm run dev` — for cockpit development server
4. `npm run build` — for production build

No undocumented prerequisites found. The README correctly notes that DataHub integration tests require a running DataHub instance (GMS :8080, MCP server).

### JUDGING.md verification paths

The 60-second, 5-minute, and 15-minute verification paths all reference commands that exist and pass:
- `npm test` — PASS
- `npm run typecheck` — PASS
- `npm run check:clean-room` — PASS
- `npm run verify:judging` — PASS (parity correctly skipped)

## Nondeterminism check

- **Test ordering:** Vitest runs tests in parallel by default; 182 tests pass consistently
- **Time-sensitive tests:** `ProofPopover` and `ProofIndicator` tests include timeout/clipboard tests with real timers — all pass
- **No `Date.now()` mocking gaps:** Tests that depend on timestamps use explicit values
- **No network-dependent unit tests:** All unit/integration tests run without a live DataHub instance (live tests are gated behind environment checks)

## Environment leak check

- **No hardcoded absolute paths** in source or test files
- **No machine-specific credentials** in committed artifacts
- **No `.env` files** committed (`.gitignore` excludes them)
- **`SECURITY.md`** documents credential handling; `credential-scan.test.ts` verifies no secrets in committed files

## Full integration path (requires live DataHub)

The full integration path (ingest → workspace.json → paired comparison → writeback → JudgeRunBundle → cockpit) requires a running DataHub instance. This was not executed in this audit worktree because:

1. Docker coordination is required to avoid overlap with Streams 07/08 read/verification windows
2. The integration path is documented in `docs/quickstart.md` and verified by `evaluation/clean-quickstart-proof.md`
3. The committed HAC-152 artifacts (`evaluation/hac-152/`) serve as frozen evidence of a successful live run

**Recommendation:** The full integration path should be executed in an isolated Docker instance to complete this audit stream. The clean-clone build/test/typecheck/lint gates all pass, confirming the codebase is ready for that step.

## Pass/fail cold-start ledger

| Check | Status | Notes |
|-------|--------|-------|
| `npm ci` | PASS | 629 packages, all published |
| `npm run build` | PASS | tsc + vite production build |
| `npm run typecheck` | PASS | 0 errors |
| `npm run lint` | PASS | 0 warnings, 0 errors |
| `npm run check:clean-room` | PASS | All deps published |
| `npm test` | PASS | 182/182 tests pass |
| `npm run verify:judging` | PASS | All required gates pass |
| `npm run parity:datahub-adapter` | SKIP | By design (needs PARITY_OLD_SIDE) |
| Hidden prerequisites | NONE | No local links, private services, or unpublished packages |
| Nondeterminism | NONE | All tests pass consistently |
| Environment leak | NONE | No hardcoded paths or credentials |

## Verdict

**PASS** — The repository builds, tests, and verifies from a clean clone using only published npm packages. No hidden prerequisites, nondeterministic steps, or environment leaks were identified. The parity gate is correctly skipped without external configuration. The full live DataHub integration path remains to be executed in an isolated Docker instance.
