# Public claim ledger

Every figure and claim in the README, with its source and verification command.
A claim that cannot be reproduced is a claim that does not belong here.

---

## Silent failure

| Claim | Value | Source | Verify |
| -- | -- | -- | -- |
| Models matched, dbt project at repo root | 5/5 | `test/integration/golden-fixture.test.ts` | `npm test` |
| Models matched, dbt project nested under `dbt/` | 0/5 (without normalization) | `test/integration/golden-fixture.test.ts` — nested fixture exercises the prefix | `npm test` |
| Corpus nodes silently discarded by `extractModels` | 23 of 28 | `evaluation/dbt-node-coverage.md` | `node scripts/build-nodetype-probe.mjs` |
| Process exit code on silent failure | 0 | Measured — the join returns empty with no error | Run the emitter against a nested project without normalization |

## Node-type coverage

| Claim | Value | Source | Verify |
| -- | -- | -- | -- |
| `original_file_path` nulls (model SQL) | 0 | `evaluation/dbt-node-coverage.md` | `node scripts/build-nodetype-probe.mjs` |
| `original_file_path` nulls (model Python) | 0 | `evaluation/dbt-node-coverage.md` | `node scripts/build-nodetype-probe.mjs` |
| `original_file_path` nulls (seed) | 0 | `evaluation/dbt-node-coverage.md` | `node scripts/build-nodetype-probe.mjs` |
| `original_file_path` nulls (snapshot) | 0 | `evaluation/dbt-node-coverage.md` | `node scripts/build-nodetype-probe.mjs` |
| `original_file_path` nulls (source) | 0 | `evaluation/dbt-node-coverage.md` | `node scripts/build-nodetype-probe.mjs` |
| `original_file_path` nulls (test) | 0 | `evaluation/dbt-node-coverage.md` | `node scripts/build-nodetype-probe.mjs` |
| dbt version tested | 1.12.0 | `evaluation/dbt-node-coverage.md` | — |

## Proof corpus

| Claim | Value | Source | Verify |
| -- | -- | -- | -- |
| Corpus repository | `https://github.com/dbt-labs/jaffle_shop_duckdb` | `evaluation/proof-corpus.md` | — |
| Corpus commit (immutable) | `36bde6cba69d962b83be1d52fc65a0dce1cb4ebb` | `evaluation/proof-corpus.md`, `test/fixtures/golden/change-impact-event.root.json` | — |
| History depth | 92 commits over ~5 years | `evaluation/proof-corpus.md` | `git -C <clone> log --oneline | wc -l` |
| Models | 5 | `evaluation/proof-corpus.md` | `jq '.nodes | length' test/fixtures/proof-corpus/manifest.json` |
| Sources | 0 | `evaluation/proof-corpus.md` | — |
| Adapter | DuckDB | `evaluation/proof-corpus.md` | — |
| dbt project location | Repository root | `evaluation/proof-corpus.md` | — |

## Golden fixtures

| Claim | Value | Source | Verify |
| -- | -- | -- | -- |
| Root fixture: `projectPrefix` | `""` | `test/fixtures/golden/change-impact-event.root.json` | `jq '.code.projectPrefix' test/fixtures/golden/change-impact-event.root.json` |
| Root fixture: `method` | `manifest-join` | `test/fixtures/golden/change-impact-event.root.json` | `jq '.code.method' test/fixtures/golden/change-impact-event.root.json` |
| Root fixture: evidence tier | `VERIFIED` | `test/fixtures/golden/change-impact-event.root.json` | `jq '.evidence.tier' test/fixtures/golden/change-impact-event.root.json` |
| Root fixture: record count | 1 | `test/fixtures/golden/change-impact-event.root.json` | `jq '.evidence.records | length' test/fixtures/golden/change-impact-event.root.json` |
| Root fixture: `checkExecuted` | `true` (all records) | `test/fixtures/golden/change-impact-event.root.json` | `jq '.evidence.records[].checkExecuted' test/fixtures/golden/change-impact-event.root.json` |
| Root fixture: `bothStatesRead` | `true` | `test/fixtures/golden/change-impact-event.root.json` | `jq '.writeback.bothStatesRead' test/fixtures/golden/change-impact-event.root.json` |
| Root fixture: `succeeded` | `true` | `test/fixtures/golden/change-impact-event.root.json` | `jq '.writeback.succeeded' test/fixtures/golden/change-impact-event.root.json` |
| Root fixture: `noop` | `true` | `test/fixtures/golden/change-impact-event.root.json` | `jq '.writeback.noop' test/fixtures/golden/change-impact-event.root.json` |
| Root fixture: upstream count | 12 | `test/fixtures/golden/change-impact-event.root.json` | `jq '.datahub.upstreams | length' test/fixtures/golden/change-impact-event.root.json` |
| Root fixture: downstream count | 1 | `test/fixtures/golden/change-impact-event.root.json` | `jq '.datahub.downstreams | length' test/fixtures/golden/change-impact-event.root.json` |
| Root fixture: lineage completeness | `not-established` | `test/fixtures/golden/change-impact-event.root.json` | `jq '.datahub.lineageObservation.upstreams.completeness' test/fixtures/golden/change-impact-event.root.json` |
| Nested fixture: `projectPrefix` | `dbt` | `test/fixtures/golden/change-impact-event.nested.json` | `jq '.code.projectPrefix' test/fixtures/golden/change-impact-event.nested.json` |
| Nested fixture: path difference | `dbt/` prefix | `test/fixtures/golden/change-impact-event.nested.json` | `jq '.code | .repositoryRelativePath != .dbtFilePath' test/fixtures/golden/change-impact-event.nested.json` |
| Contract version | `1.3` | `src/integration/change-impact-event.ts` | `grep CHANGE_IMPACT_EVENT_VERSION src/integration/change-impact-event.ts` |
| Both fixtures pass contract validation | yes | `test/integration/golden-fixture.test.ts` | `npm test` |

## Live evidence package (HAC-152)

| Claim | Value | Source | Verify |
| -- | -- | -- | -- |
| Capture date | 2026-07-29 | `evaluation/hac-152/README.md` | — |
| Subject URN | `urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)` | `evaluation/hac-152/live-mcp-event.json` | `jq '.subject.urn' evaluation/hac-152/live-mcp-event.json` |
| Corpus | `dcaribou/transfermarkt-datasets@59fa295c` | `evaluation/hac-152/README.md` | — |
| Resolved source | `dbt/models/curated/game_events.sql` | `evaluation/hac-152/live-mcp-event.json` | `jq '.code.repositoryRelativePath' evaluation/hac-152/live-mcp-event.json` |
| `code.sourceUrl` under MCP | `null` | `evaluation/hac-152/live-mcp-event.json` | `jq '.code.sourceUrl' evaluation/hac-152/live-mcp-event.json` |
| Writeback: before tier | `null` | `evaluation/hac-152/live-event-with-writeback.json` | `jq '.writeback.before.evidenceTier' evaluation/hac-152/live-event-with-writeback.json` |
| Writeback: after tier | `VERIFIED` | `evaluation/hac-152/live-event-with-writeback.json` | `jq '.writeback.after.evidenceTier' evaluation/hac-152/live-event-with-writeback.json` |
| Writeback: `bothStatesRead` | `true` | `evaluation/hac-152/live-event-with-writeback.json` | `jq '.writeback.bothStatesRead' evaluation/hac-152/live-event-with-writeback.json` |
| Plan comparison: model | `qwen-plus` | `evaluation/hac-152/live-qwen-judge-run-bundle.json` | `jq '.comparison.joinedPlan.run.model' evaluation/hac-152/live-qwen-judge-run-bundle.json` |
| Plan comparison: deltas | 3 (added, removed, constrained) | `evaluation/hac-152/live-qwen-judge-run-bundle.json` | `jq '.comparison.deltas | length' evaluation/hac-152/live-qwen-judge-run-bundle.json` |
| Plan comparison: upstream observed | 8 | `evaluation/hac-152/live-qwen-judge-run-bundle.json` | `jq '.event.datahub.lineageObservation.upstreams.observedCount' evaluation/hac-152/live-qwen-judge-run-bundle.json` |
| Plan comparison: downstream observed | 1 | `evaluation/hac-152/live-qwen-judge-run-bundle.json` | `jq '.event.datahub.lineageObservation.downstreams.observedCount' evaluation/hac-152/live-qwen-judge-run-bundle.json` |
| Checksums valid | yes | `evaluation/hac-152/SHA256SUMS` | `cd evaluation/hac-152 && shasum -a 256 -c SHA256SUMS` |

## MCP field coverage

| Claim | Value | Source | Verify |
| -- | -- | -- | -- |
| `externalUrl` held by DataHub | yes | `evaluation/mcp-field-coverage.md` | `node scripts/probe-mcp-dataset-fields.mjs` |
| `externalUrl` projected by MCP | no | `evaluation/mcp-field-coverage.md` | `node scripts/probe-mcp-dataset-fields.mjs` |
| MCP server version | `3.4.5` | `evaluation/mcp-field-coverage.md` | — |
| GMS version | `v1.5.0.6` | `evaluation/mcp-field-coverage.md` | — |
| Upstream fix filed | yes, against `acryldata/mcp-server-datahub` | `evaluation/mcp-field-coverage.md` | — |
| Probe exits non-zero when gap closes | yes | `evaluation/mcp-field-coverage.md` | `node scripts/probe-mcp-dataset-fields.mjs` |

## Clean quickstart proof

| Claim | Value | Source | Verify |
| -- | -- | -- | -- |
| Instance destroyed and rebuilt before run | yes | `evaluation/clean-quickstart-proof.md` | — |
| Conditions asserted from JSON | 11 | `evaluation/clean-quickstart-proof.md` | — |
| Read path succeeded | yes | `evaluation/clean-quickstart-proof.md` | — |
| Writeback succeeded | yes | `evaluation/clean-quickstart-proof.md` | — |
| Reset succeeded | yes | `evaluation/clean-quickstart-proof.md` | — |

## Adapter parity

| Claim | Value | Source | Verify |
| -- | -- | -- | -- |
| Parity checks against frozen baseline | 35/35 | `migration/parity-datahub-shim.mjs` | `npm run parity:datahub-adapter` |

## Clean-room audit

| Claim | Value | Source | Verify |
| -- | -- | -- | -- |
| Controlled dependencies at exact versions | `@workspacejson/cli@0.5.0`, `@workspacejson/spec@0.4.4` | `test/policy/clean-room.test.ts` | `npm run check:clean-room` |
| No path references in dependencies | yes | `test/policy/clean-room.test.ts` | `npm run check:clean-room` |
| No local links in lockfile | yes | `test/policy/clean-room.test.ts` | `npm run check:clean-room` |

## Known limitations

| Claim | Source |
| -- | -- |
| No completeness claim | `evaluation/proof-corpus.md`, every event carries `not-established` |
| `externalUrl` dropped at MCP boundary | `evaluation/mcp-field-coverage.md` |
| Shallow corpus history (92 commits) | `evaluation/proof-corpus.md` |
| No co-change evidence from producer | `docs/provenance.md` — producer withholds behavioral values |
| Sources point at declaration YAML | `evaluation/dbt-node-coverage.md` |
| One subject per golden fixture | `test/fixtures/golden/` — root and nested, one dataset each |
