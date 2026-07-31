# Evaluation

Evidence artifacts proving the claims in this repository. Each document below
establishes a specific fact and is independently verifiable.

## Evidence index

| Document | What it establishes | How to verify |
| -- | -- | -- |
| [`proof-corpus.md`](proof-corpus.md) | Frozen corpus selection, commit pin, lineage quality, known limitations | Read; clone and build the manifest locally |
| [`dbt-node-coverage.md`](dbt-node-coverage.md) | `original_file_path` populated for every dbt node type — zero nulls | `node scripts/build-nodetype-probe.mjs` |
| [`mcp-field-coverage.md`](mcp-field-coverage.md) | `externalUrl` held by DataHub but dropped at the MCP boundary | `node scripts/probe-mcp-dataset-fields.mjs` |
| [`clean-quickstart-proof.md`](clean-quickstart-proof.md) | Read path, writeback, and reset against a destroyed-and-rebuilt DataHub | `scripts/clean-quickstart-proof.sh` |
| [`corpus-forge-screen.md`](corpus-forge-screen.md) | Measurement-corpus candidate screen for nested-project normalization | `node scripts/screen-corpus-candidates.mjs` |
| [`lineage-readiness-signals.md`](lineage-readiness-signals.md) | DataHub index-convergence signals and readiness-gate design constraints | Read; reproduce against a local quickstart |
| [`hac-152/`](hac-152/) | Live evidence package: MCP event, writeback receipt, paired plan comparison | `cd hac-152 && shasum -a 256 -c SHA256SUMS` |

## Quickstart

From a clean clone:

```bash
npm install
npm run verify:judging
```

This runs typecheck, clean-room audit, the full test suite, and adapter parity
in sequence. See [`JUDGING.md`](../JUDGING.md) for guided evaluation paths.
