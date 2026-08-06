# Public claim ledger

> **Type:** Reference | **Status:** Current | **Scope:** All public claims

Every figure and claim in the README, with its source and verification command.
A claim that cannot be reproduced is a claim that does not belong here.

> **Single-command verification:** `npm ci && npm run verify:judging` runs all
> gates below in sequence and emits a PASS/FAIL/SKIP ledger. Individual commands
> are listed per-claim for targeted verification.

---

## Silent failure

| Claim | Value | Source | Verify |
| -- | -- | -- | -- |
| Models matched, dbt project at repo root | 5/5 | `test/integration/golden-fixture.test.ts` | `npm test` |
| Models matched, dbt project nested under `dbt/` | 0/5 (without normalization) | `test/integration/golden-fixture.test.ts` — nested fixture exercises the prefix | `npm test` |
| Process exit code on silent failure | 0 | `scripts/prove-silent-zero.mjs` — naive join returns 0/5 with no error and exit 0 | `node scripts/prove-silent-zero.mjs` |

The `extractModels` node-drop figure used to sit in this table. It was moved to
node accounting below on 2026-07-30, because it measures a different thing:
adapter node-type filtering, not the path-normalization failure the rows above
describe. Read beside `5/5`, it also invited an arithmetic contradiction that only
the node-kind decomposition resolves.

## Node accounting

The join accounts for every node in the manifest, and the figures below are about
that accounting rather than about a failure.

| Claim | Value | Source | Verify |
| -- | -- | -- | -- |
| Proof-corpus nodes accounted for | 28 of 28 | `evaluation/dbt-node-coverage.md` | `npm test`, in `test/adapters/workspacejson/nodes-join.integration.test.ts` |
| Kept, dataset-bearing | 8 (5 `model`, 3 `seed`) | Same | Same |
| Excluded by policy, not datasets | 20 (`test`) | Same | Same |
| Dropped, dataset-bearing with no `original_file_path` | 0 | Same | Same |
| Dataset-bearing kinds | `model`, `seed`, `snapshot` | `src/adapters/workspacejson/nodes.ts` `DATASET_RESOURCE_TYPES` | Read the exported set |
| Nodes kept by the legacy `extractModels` | 5 of 28, filtering `resource_type === "model"` | `evaluation/dbt-node-coverage.md` | `node scripts/build-nodetype-probe.mjs` *(manual — not in CI)* |

`extractModels` is **not on the join path.** It is retained byte-identical because
the adapter adoption parity harness pins it at 35/35, and the join runs through
`extractDatasetNodes`, which enforces
`nodes.length + dropped.length + sum(excluded) === total`. Its 5-of-28 filtering
is a property of a frozen function, not a defect in the current pipeline, and it
is listed here so the figure has one accurate home rather than an alarming one.

## Node-type coverage

| Claim | Value | Source | Verify |
| -- | -- | -- | -- |
| `original_file_path` nulls (model SQL) | 0 | `evaluation/dbt-node-coverage.md` | `node scripts/build-nodetype-probe.mjs` *(manual — not in CI)* |
| `original_file_path` nulls (model Python) | 0 | `evaluation/dbt-node-coverage.md` | `node scripts/build-nodetype-probe.mjs` *(manual — not in CI)* |
| `original_file_path` nulls (seed) | 0 | `evaluation/dbt-node-coverage.md` | `node scripts/build-nodetype-probe.mjs` *(manual — not in CI)* |
| `original_file_path` nulls (snapshot) | 0 | `evaluation/dbt-node-coverage.md` | `node scripts/build-nodetype-probe.mjs` *(manual — not in CI)* |
| `original_file_path` nulls (source) | 0 | `evaluation/dbt-node-coverage.md` | `node scripts/build-nodetype-probe.mjs` *(manual — not in CI)* |
| `original_file_path` nulls (test) | 0 | `evaluation/dbt-node-coverage.md` | `node scripts/build-nodetype-probe.mjs` *(manual — not in CI)* |
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
| Contract version | `1.4` | `src/integration/change-impact-event.ts` | `grep CHANGE_IMPACT_EVENT_VERSION src/integration/change-impact-event.ts` |
| Versions a reader still validates | `1.3`, `1.4` | `src/integration/change-impact-event.ts` `READABLE_EVENT_VERSIONS` | `grep -A2 'READABLE_EVENT_VERSIONS =' src/integration/change-impact-event.ts` |
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

## Repeated paired evaluation (HAC-150)

Ten paired runs under two conditions, holding task, model, prompt, decoding
settings, repository revision and DataHub snapshot constant. The context
envelope is the only varying input. Continuity with HAC-152 rests on the exact
HAC-152 task prompt together with the pinned experimental inputs: the same
event digest, the same corpus revision, the same model and the same decoding
settings. The matching prompt digest records that the prompt was unchanged; it
is not on its own what makes the two runs comparable.

Every denominator below is the pairs **requested**. A run that failed or
returned unparsable output is reported as a failure and stays in the
denominator, so no rate is computed against a subset that happened to conform.

| Claim | Value | Source | Verify |
| -- | -- | -- | -- |
| Pairs requested | 10 | `evaluation/hac-150/manifest.json` | `jq '.experiment.pairsRequested' evaluation/hac-150/manifest.json` |
| Pairs observed | 10/10 | `evaluation/hac-150/aggregate.json` | `jq '.pairsObserved' evaluation/hac-150/aggregate.json` |
| Recorded failures | 0 | `evaluation/hac-150/aggregate.json` | `jq '.failures \| length' evaluation/hac-150/aggregate.json` |
| **Exact source revision included, joined context** | **10/10** | `evaluation/hac-150/aggregate.json` | `jq '.measures.exactRevisionOnlyInJoined' evaluation/hac-150/aggregate.json` |
| **Exact source revision included, DataHub-only** | **0/10** | `evaluation/hac-150/pairs.json` — no DataHub-only observation references any revision token | `jq '[.pairs[].datahubOnly.observation.revisionsReferenced[]?] \| length' evaluation/hac-150/pairs.json` |
| **Distinct normalized step sequences, DataHub-only** | **5** across 10 runs | `evaluation/hac-150/aggregate.json` | `jq '.stability.datahubOnly.distinctSequences' evaluation/hac-150/aggregate.json` |
| **Distinct normalized step sequences, joined** | **1** across 10 runs | `evaluation/hac-150/aggregate.json` | `jq '.stability.joined.distinctSequences' evaluation/hac-150/aggregate.json` |
| Refusal present, DataHub-only | 10/10 | `evaluation/hac-150/aggregate.json` | `jq '.stability.datahubOnly.refusalPresent' evaluation/hac-150/aggregate.json` |
| Refusal removed by join | 10/10 | `evaluation/hac-150/aggregate.json` | `jq '.measures.refusalRemovedByJoin' evaluation/hac-150/aggregate.json` |
| Position effect (order counterbalanced) | none: 5/5 in both arms | `evaluation/hac-150/aggregate.json` | `jq '.orderEffect' evaluation/hac-150/aggregate.json` |
| Model | `qwen-plus` | `evaluation/hac-150/manifest.json` | `jq '.experiment.model' evaluation/hac-150/manifest.json` |
| Decoding settings | `{"temperature":0}` | `evaluation/hac-150/manifest.json` | `jq '.experiment.settings' evaluation/hac-150/manifest.json` |
| Prompt digest, identical to HAC-152 | `sha256:d19f4d09…` | `evaluation/hac-150/manifest.json` | `jq -r '.experiment.promptDigest' evaluation/hac-150/manifest.json` |
| Raw model outputs archived | 20 files, one per condition per pair | `evaluation/hac-150/raw/` | `ls evaluation/hac-150/raw \| wc -l` |

"Distinct normalized step sequences" counts sequences of step **ids**, not raw
prose. Two runs whose wording differs but whose step ids match count as one
sequence; this is not a claim that ten runs produced byte-identical plans.

### Paired-arm summaries

The rows above state each arm separately, which is the right shape for
verification and the wrong shape for a diagram: a figure that shows one arm
without the other is not the finding. The three rows below are the both-arm
summaries the README's HAC-150 graphic quotes, so the image has one named row to
agree with rather than a reader's arithmetic across two.

| Claim | Value | Source | Verify |
| -- | -- | -- | -- |
| Exact source revision in plan | joined 10/10, DataHub-only 0/10 | `evaluation/hac-150/aggregate.json`, `evaluation/hac-150/pairs.json` | `jq '.measures.exactRevisionOnlyInJoined' evaluation/hac-150/aggregate.json` |
| Normalized plan-shape stability | DataHub-only 5 sequences, joined 1 | `evaluation/hac-150/aggregate.json` | `jq '[.stability.datahubOnly.distinctSequences, .stability.joined.distinctSequences]' evaluation/hac-150/aggregate.json` |
| Refusal behaviour on the unknown repository source | present 10/10 DataHub-only, removed 10/10 joined | `evaluation/hac-150/aggregate.json` | `jq '[.stability.datahubOnly.refusalPresent, .measures.refusalRemovedByJoin]' evaluation/hac-150/aggregate.json` |

## Platform feedback

The inventory is a count of what was written down, not a claim that any finding
was accepted upstream. The open question is counted apart from the eleven
because it was never reproduced; folding it in would report a suspicion as a
finding.

| Claim | Value | Source | Verify |
| -- | -- | -- | -- |
| Settled findings and open questions | 11 findings, 1 open question | `FEEDBACK.md` | `grep -cE '^## [0-9]+\. ' FEEDBACK.md` for the findings; `grep -c '^## The open question' FEEDBACK.md` for the question |
| Upstream submissions filed | 2, both open | `FEEDBACK.md` — `acryldata/mcp-server-datahub#149`, `datahub-project/datahub#18754` | Open each pull request and read its state |

## Cockpit architecture boundary

| Claim | Value | Source | Verify |
| -- | -- | -- | -- |
| Cockpit architecture boundary | committed events cross Zod into `CockpitViewModel`; no browser-loaded module reaches the network; the three routes render offline | `docs/cockpit-architecture.md`, `apps/cockpit/src/data/architecture-invariants.test.ts` | `npm run test:cockpit` |
| Components accept only `CockpitViewModel` | yes | `apps/cockpit/src/model/from-change-impact-event.ts` | `npm run test:cockpit` |
| No browser-loaded module can reach the network | yes | `apps/cockpit/src/data/architecture-invariants.test.ts` — "keeps every module the browser loads free of network calls" | `npm run test:cockpit` |
| No stylesheet loads a remote font or asset | yes | `apps/cockpit/src/data/architecture-invariants.test.ts` | `npm run test:cockpit` |
| The committed build never leaves its origin | yes | `apps/cockpit/e2e/first-frame.spec.ts` — "the committed build renders the golden subject and never leaves its origin" | `npm run e2e` *(manual — requires browsers)* |

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
| Parity checks against frozen baseline | 34/35 | `migration/parity-datahub-shim.mjs` | `npm run parity:datahub-adapter` *(manual — not in CI)* |

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
| Shallow *root* corpus history (92 commits, Jaffle Shop only) | `evaluation/proof-corpus.md` |
| No co-change evidence from producer | `evaluation/proof-corpus.md` — the producer, `@workspacejson/cli@0.5.0`, deliberately withholds behavioral values; its own `CHANGELOG.md` records `coChange` and `fragility` as unemitted |
| Sources point at declaration YAML | `evaluation/dbt-node-coverage.md` |
| One subject per golden fixture | `test/fixtures/golden/` — root and nested, one dataset each |
| Artifact fidelity regeneration | SKIP — requires `WORKSPACEJSON_CORPUS_*` env var pointing at a live checkout; see `test/integration/artifact-fidelity.test.ts:220` |
