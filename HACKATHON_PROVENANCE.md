# Hackathon provenance

This document separates pre-existing work from new work, so a hackathon judge
can tell what was built during the event and what was adopted from prior
development.

---

## Pre-existing work

These components were developed before the hackathon as part of the
[workspace.json](https://github.com/workspacejson) standard and its tooling.
They are consumed by Tally as released, published npm packages or adopted with
full provenance — never via source-level cross-org imports.

### workspace.json standard and CLI

- **`@workspacejson/spec@0.4.4`** — the schema specification for workspace
  artifacts. Published to npm, consumed at an exact version.
- **`@workspacejson/cli@0.5.0`** — the producer that generates `workspace.json`
  artifacts from a repository checkout. Published to npm, consumed at an exact
  version.

**Clean-room rule:** Tally consumes only these published packages. No
`file:`, `link:`, `workspace:`, or git references to controlled packages. The
audit runs as `npm run check:clean-room` and is enforced by
[`test/policy/clean-room.test.ts`](test/policy/clean-room.test.ts).

See [`docs/clean-room.md`](docs/clean-room.md) for the full rule and the
recorded exception.

### dbt path-normalization adapter

The five files in [`src/adapters/workspacejson/`](src/adapters/workspacejson/)
were adopted from the workspacejson CLI's internal dbt adapter (the adapter adoption ruling).
This is the only recorded exception to the clean-room import rule, documented
in [`docs/provenance.md`](docs/provenance.md).

**What was adopted:**
- `resolveDbtPath.ts` — dbt model → source path resolution
- `fileIndex.ts` — workspace.json fileIndex lookup
- `normalizePath.ts` — project-prefix normalization
- `types.ts` — shared types
- `index.ts` — barrel export

**What was added (new work, not adopted):**
- `nodes.ts` — non-silent node extraction with accounting

> **Correction 2026-07-29 (HAC-273):** `urn.ts` was removed as dormant. See
> [`docs/provenance.md`](docs/provenance.md) for the HAC-147 reconciliation.

**Parity verification:** 34/35 checks pass against the frozen migration
baseline (one pre-existing failure; see `docs/provenance.md`). Run `npm run parity:datahub-adapter`.

### Proof corpus

The proof corpus (`dbt-labs/jaffle_shop_duckdb`) is a third-party open-source
project, frozen at an immutable commit. It is not Tally's work. See
[`evaluation/proof-corpus.md`](evaluation/proof-corpus.md).

---

## New work (built during the hackathon)

Everything below was built during the hackathon, authored fresh from the spec
and the workspace.json standard. None of it is imported from the parent
platform or the workspacejson CLI source.

### DataHub integration

| Component | File(s) | What it does |
| -- | -- | -- |
| Non-silent node extraction | `src/adapters/workspacejson/nodes.ts` | Reports every dbt node as kept, dropped, or excluded — no silent zeros |
| Change-impact event contract | `src/integration/change-impact-event.ts` | The versioned, Zod-validated, drift-guarded event contract (v1.3) |
| MCP read path | `src/integration/mcp-read.ts` | Reads DataHub through the official MCP server: entities, lineage, schema |
| Writeback with observed receipts | `src/integration/writeback.ts` | Writes link + tier, observes before/after, produces a receipt with five outcomes |
| Workspace evidence | `src/integration/workspace-evidence.ts` | Provenance sidecar, integrity check, artifact identity |
| Plan comparison | `src/integration/plan-comparison.ts` | Paired DataHub-only vs joined plan comparison with `RunIdentity` |
| Artifact fidelity | `src/integration/artifact-fidelity.ts` | Fixture regeneration and comparison against frozen baselines |
| Change impact event | `src/integration/change-impact-event.ts` | Event emitter joining DataHub context with workspace.json evidence |

### Cockpit UI

| Component | Location | What it does |
| -- | -- | -- |
| React application | `apps/cockpit/` | Three-view sequence: Impact → Change plan → Receipts |
| CockpitViewModel | `apps/cockpit/src/` | Zod-validated view model; components accept only this |
| E2E tests | `apps/cockpit/e2e/` | Playwright tests for the judge-facing surface |

**Technology stack:** React 19, TypeScript, Vite 8, Tailwind 4, Zod 4, Vitest,
Playwright. See [`docs/cockpit-architecture.md`](docs/cockpit-architecture.md).

### Scripts and tooling

| Script | What it does |
| -- | -- |
| `scripts/assert-proof.mjs` | Asserts proof corpus integrity |
| `scripts/build-corpus-fixture.mjs` | Builds test fixtures from the proof corpus |
| `scripts/build-nodetype-probe.mjs` | Probes `original_file_path` coverage by node type |
| `scripts/check-clean-room.mjs` | Runs the clean-room audit |
| `scripts/probe-mcp-dataset-fields.mjs` | Measures MCP field coverage (the `externalUrl` gap) |
| `scripts/screen-corpus-candidates.mjs` | Screens corpus candidates by PR history |

### Evaluation evidence

| Document | What it establishes |
| -- | -- |
| `evaluation/proof-corpus.md` | Frozen corpus selection and rationale |
| `evaluation/dbt-node-coverage.md` | Node-type coverage with zero nulls |
| `evaluation/mcp-field-coverage.md` | MCP `externalUrl` gap measurement |
| `evaluation/clean-quickstart-proof.md` | End-to-end proof against a rebuilt DataHub |
| `evaluation/corpus-forge-screen.md` | Corpus candidate screen |
| `evaluation/hac-152/` | Live evidence package: MCP event, writeback, plan comparison |

### Tests

| Suite | File(s) | What it covers |
| -- | -- | -- |
| Contract validation | `test/integration/change-impact-event.test.ts` | Zod schemas, drift guards, `deriveTier`, `toDataHubOnly` |
| Golden fixtures | `test/integration/golden-fixture.test.ts` | Both fixtures against the frozen contract and writeback invariants |
| Writeback | `test/integration/writeback.test.ts` | Receipt invariants, five outcomes, stale-read handling |
| Workspace evidence | `test/integration/workspace-evidence.test.ts` | Integrity checks, mismatch handling |
| Clean-room | `test/policy/clean-room.test.ts` | Dependency audit against poisoned manifests |
| README claims | `test/docs/readme-claims.test.ts` | No perishable counts, evidence vocabulary present |
| Demo cut | `test/docs/hac-217-demo-cut.test.ts` | HAC-217 ratification ledger |
| Artifact fidelity | `test/integration/artifact-fidelity.test.ts` | Fixture regeneration against frozen baselines |
| Live evidence | `test/integration/hac-152-live-package.test.ts` | HAC-152 committed package checksums and pinned values |

---

## Upstream contributions filed during the hackathon

| Issue | Target | Status |
| -- | -- | -- |
| `externalUrl` MCP projection | `acryldata/mcp-server-datahub` | Filed, one-line fix verified end-to-end |
| `node:fs` type-stub masking | `workspacejson/cli` | Filed |

---

## Summary

| Category | Components |
| -- | -- |
| Pre-existing (consumed) | `@workspacejson/spec`, `@workspacejson/cli`, dbt path adapter (5 files, adopted with parity) |
| Pre-existing (third-party) | `dbt-labs/jaffle_shop_duckdb` (proof corpus), DataHub, dbt |
| New (hackathon) | Non-silent extraction, event contract, MCP read, writeback, plan comparison, cockpit, all scripts, all evaluation, all tests |
