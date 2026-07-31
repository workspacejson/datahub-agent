# Judge artifacts

Checked-in artifacts a judge can inspect without running anything. Each entry
names the file, what it demonstrates, and how to verify it.

## Golden fixtures

Real emitted `ChangeImpactEvent` objects with attached writeback receipts,
committed so every judge-facing surface renders the same evidence without
needing a DataHub instance.

| File | What it shows |
| -- | -- |
| [`test/fixtures/golden/change-impact-event.root.json`](../test/fixtures/golden/change-impact-event.root.json) | Root-level dbt project: `projectPrefix: ""`, paths coincide, `VERIFIED` tier, `noop: true` writeback |
| [`test/fixtures/golden/change-impact-event.nested.json`](../test/fixtures/golden/change-impact-event.nested.json) | Nested dbt project: `projectPrefix: "dbt"`, paths differ by prefix, exercises the normalization that makes the join work |

**Verify:** `npm test` — the golden-fixture tests validate both fixtures
against the frozen contract, writeback invariants, and project-layout coverage.

## Live evidence package

A real run captured on 2026-07-29 against a live DataHub OSS instance with a
nested dbt project (`dcaribou/transfermarkt-datasets@59fa295c`).

| File | What it shows |
| -- | -- |
| [`evaluation/hac-152/live-mcp-event.json`](../evaluation/hac-152/live-mcp-event.json) | Event read through the official DataHub MCP server over stdio; `code.sourceUrl` is null (MCP drops `externalUrl`) |
| [`evaluation/hac-152/live-event-with-writeback.json`](../evaluation/hac-152/live-event-with-writeback.json) | Same event after a real observed writeback: `null` → `VERIFIED`, `bothStatesRead: true`, link omitted with stated reason |
| [`evaluation/hac-152/live-qwen-judge-run-bundle.json`](../evaluation/hac-152/live-qwen-judge-run-bundle.json) | Paired Qwen plan comparison: DataHub-only vs joined, three deltas (added, removed, constrained), identical run parameters |
| [`evaluation/hac-152/SHA256SUMS`](../evaluation/hac-152/SHA256SUMS) | SHA-256 checksums for all three JSON artifacts |

**Verify:** `cd evaluation/hac-152 && shasum -a 256 -c SHA256SUMS`

**Read:** [`evaluation/hac-152/README.md`](../evaluation/hac-152/README.md) for
the full context, limitations, and reproduction instructions.

## Evaluation records

| File | What it shows |
| -- | -- |
| [`evaluation/proof-corpus.md`](../evaluation/proof-corpus.md) | Frozen proof corpus selection: `dbt-labs/jaffle_shop_duckdb@36bde6cb`, history depth, lineage quality, known limitations |
| [`evaluation/dbt-node-coverage.md`](../evaluation/dbt-node-coverage.md) | `original_file_path` coverage by dbt node type: zero nulls across model SQL, model Python, seed, snapshot, source, test |
| [`evaluation/mcp-field-coverage.md`](../evaluation/mcp-field-coverage.md) | What DataHub holds vs what MCP projects: `externalUrl` dropped at the boundary, measured against a live instance |
| [`evaluation/clean-quickstart-proof.md`](../evaluation/clean-quickstart-proof.md) | End-to-end proof against a destroyed and rebuilt DataHub: read path, writeback, reset, eleven conditions asserted from JSON |
| [`evaluation/corpus-forge-screen.md`](../evaluation/corpus-forge-screen.md) | Corpus candidate screen: 12 repositories measured by merged PR count × multi-commit ratio, with disqualifications |

## Proof corpus fixtures

Frozen `workspace.json` artifacts and dbt manifests used by the test suite.

| File | What it shows |
| -- | -- |
| [`test/fixtures/proof-corpus/`](../test/fixtures/proof-corpus/) | `jaffle_shop_duckdb` workspace.json + provenance sidecar + dbt manifest |
| [`test/fixtures/proof-corpus-transfermarkt/`](../test/fixtures/proof-corpus-transfermarkt/) | `transfermarkt-datasets` workspace.json + provenance sidecar (nested at `dbt/`) |

**Verify:** `npm run parity:datahub-adapter` — checks 35/35 against the frozen
migration baseline.

## Contract and source

| File | What it shows |
| -- | -- |
| [`src/integration/change-impact-event.ts`](../src/integration/change-impact-event.ts) | The `ChangeImpactEvent` contract: TypeScript interfaces, Zod schemas, drift guards, `deriveTier`, `toDataHubOnly` |
| [`src/integration/writeback.ts`](../src/integration/writeback.ts) | Writeback logic: what gets written (link + tier), what is excluded, receipt invariants |
| [`src/integration/plan-comparison.ts`](../src/integration/plan-comparison.ts) | Plan comparison contract: `RunIdentity`, delta types, bundle validation |
| [`src/integration/mcp-read.ts`](../src/integration/mcp-read.ts) | MCP read path: three tool calls, lineage hop bound, `externalUrl` gap |
| [`src/integration/workspace-evidence.ts`](../src/integration/workspace-evidence.ts) | Workspace evidence: provenance sidecar, integrity check, artifact identity |

## Documentation

| File | What it shows |
| -- | -- |
| [`docs/evidence.md`](../docs/evidence.md) | Evidence terminology and invariants: read, completeness, unavailable reasons, tier derivation |
| [`docs/claims.md`](../docs/claims.md) | Public claim ledger: every figure in the README with its source and verification command |
| [`docs/cockpit-architecture.md`](../docs/cockpit-architecture.md) | Cockpit technology stack and architecture decisions |
| [`docs/quickstart.md`](../docs/quickstart.md) | Full DataHub setup, MCP server installation, enrichment workflow |
| [`docs/provenance.md`](../docs/provenance.md) | Adapter adoption provenance: source, identity, parity checks |
| [`docs/clean-room.md`](../docs/clean-room.md) | Clean-room import rule: only published `@workspacejson/*` packages |
| [`docs/adopter-contract.md`](../docs/adopter-contract.md) | DataHub integration and compatibility contract: extension surfaces, fields read/written, credentials, degraded behavior, contract versions |
| [`docs/manual-commands.md`](../docs/manual-commands.md) | Manual verification commands requiring external services (DataHub, Docker, network) |
| [`docs/feedback-evidence.md`](../docs/feedback-evidence.md) | Development feedback log: what worked, what caused delays, bugs and resolutions |
| [`HACKATHON_PROVENANCE.md`](../HACKATHON_PROVENANCE.md) | Pre-existing vs new work separation for hackathon judges |

## Verification commands

```bash
npm test                        # contract, writeback, join, and cockpit suites
npm run typecheck               # TypeScript strict mode
npm run check:clean-room        # every dependency resolves to a published version
npm run parity:datahub-adapter  # 35/35 against the frozen migration baseline
```

For the full judging guide with 60-second, 5-minute, and 15-minute paths, see
[`JUDGING.md`](../JUDGING.md).
