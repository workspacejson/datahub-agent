# Evaluation

> **Type:** Evaluation | **Status:** Current | **Scope:** All evidence artifacts

Evidence artifacts proving the claims in this repository. Each entry below
routes a public claim to its scoped artifact, verification command, and status.

## Evidence ledger

| Claim | Artifact | Verification | Status | Captured |
| -- | -- | -- | -- | -- |
| Frozen corpus selection, commit pin, lineage quality | [`proof-corpus.md`](proof-corpus.md) | Read; clone and build the manifest locally | Current | 2026-07-26 |
| `original_file_path` populated for every dbt node type — zero nulls | [`dbt-node-coverage.md`](dbt-node-coverage.md) | `node scripts/build-nodetype-probe.mjs` (manual) | Current | 2026-07-26 |
| `externalUrl` held by DataHub but dropped at the MCP boundary | [`mcp-field-coverage.md`](mcp-field-coverage.md) | `node scripts/probe-mcp-dataset-fields.mjs` | Current | 2026-07-27 |
| Read path, writeback, and reset against a destroyed-and-rebuilt DataHub | [`clean-quickstart-proof.md`](clean-quickstart-proof.md) | `scripts/clean-quickstart-proof.sh` | Current | 2026-07-27 |
| Measurement-corpus candidate screen for nested-project normalization | [`corpus-forge-screen.md`](corpus-forge-screen.md) | `node scripts/screen-corpus-candidates.mjs` | Current | 2026-07-26 |
| DataHub index-convergence signals and readiness-gate design constraints | [`lineage-readiness-signals.md`](lineage-readiness-signals.md) | Read; reproduce against a local quickstart | Current | 2026-07-29 |
| Live evidence package: MCP event, writeback receipt, paired plan comparison | [`hac-152/`](hac-152/) | `cd hac-152 && shasum -a 256 -c SHA256SUMS` | Current | 2026-07-29 |
| Transfermarkt lineage readiness manifests | [`hac-231/`](hac-231/) | Read | Current | 2026-07-29 |
| Cold-reader observation kit | [`hac-228/`](hac-228/) | Read | Current | 2026-07-30 |
| Catalog baseline snapshots | [`hac-248/`](hac-248/) | Read | Current | 2026-07-29 |
| Unresolved repository mismatch fixture | [`hac-267/`](hac-267/) | Read | Current | 2026-07-31 |

## Quickstart

From a clean clone:

```bash
npm install
npm run verify:judging
```

This runs typecheck, clean-room audit, the full test suite, and adapter parity
in sequence. See [`JUDGING.md`](../JUDGING.md) for guided evaluation paths.
