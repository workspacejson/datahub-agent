# datahub-agent

Public, Apache-2.0 reference application consuming released [`workspacejson`](https://github.com/workspacejson) interfaces against [DataHub](https://datahubproject.io/). Built for the *Build with DataHub: The Agent Hackathon*.

## What this repository is — and isn't

This ecosystem spans three distinct repositories. Do not conflate them:

| Repository | Role | Owner |
|---|---|---|
| `workspacejson/*` (schema, `@workspacejson/cli`, producer) | The neutral standard and producer. Defines workspace.json, the four stable read paths, and neutral producer conformance. | workspacejson |
| **`workspacejson/datahub-agent`** (this repo) | The DataHub **application**: orchestration, official DataHub MCP consumption, dbt/DataHub URN-to-source-file joins, OSS-safe writeback, evaluation, demo assets. | workspacejson |
| External pipeline proof corpus | The public dbt/pipeline repository used as the measurement and demo surface. Selected and pinned at an immutable commit by [HAC-143](https://linear.app/marcelle-labs/issue/HAC-143). | n/a (external, third-party) |

This repository owns none of: the workspace.json schema, `@workspacejson/cli`, the four stable read paths, neutral producer conformance, private Vreko source, private Marcelle Labs swarm source, or workspace.json v0.5 design. Those live upstream in `workspacejson/*`.

This repository is **not** the proof corpus. It consumes the proof corpus (once selected by HAC-143) as an external, read-only input — it does not vendor or embed it.

## Ownership ruling

Recorded per [HAC-214](https://linear.app/marcelle-labs/issue/HAC-214):

```
REPOSITORY OWNER: workspacejson
REPOSITORY PATH:  workspacejson/datahub-agent
RATIONALE:        Public Apache-2.0 reference consumer of released workspace.json
                   interfaces. The application advances ecosystem adoption and
                   contains no private Marcelle Labs or Vreko implementation
                   dependency.
PROOF CORPUS:     HAC-143 (tracked separately, not part of this repository)
```

## Dependency boundary

- Consumes only **released, public** `@workspacejson/*` packages.
- No source-level cross-org imports. See [`docs/clean-room.md`](docs/clean-room.md).
- Must remain fully runnable **without** a Vreko daemon.
- DataHub-specific consumption of `workspacejson signals datahub` is gated behind [HAC-213](https://linear.app/marcelle-labs/issue/HAC-213)'s Path-B ruling. Until that ruling records `PATH B: IN`, this repository does not depend on that surface.

## Repository layout

```
src/adapters/workspacejson/   the dbt/DataHub join: path normalization, URN
                              resolution, fileIndex join  (see its README)
test/                         tests and proof-corpus fixtures
migration/                    parity harness for the adopted adapter
scripts/                      fixture and probe generators
docs/                         clean-room rule, adoption provenance, feedback log
examples/                     runnable, judge-visible usage examples
evaluation/                   proof corpus, node-type coverage, measurement
```

## Verifying this repository

```bash
npm install
npm test                        # contract, writeback, join, and cockpit suites
npm run typecheck
npm run check:clean-room        # every dependency resolves to a published version
npm run parity:datahub-adapter  # 35/35 against the frozen migration baseline
```

This used to claim a test count. It said "27" long after the real number had
passed 400, which is the failure this project is built to refuse — a number
asserted once and never re-checked, on the page a reader trusts most. The
command reports its own count, and that count cannot go stale.

The parity figure stays because it is a fixed baseline: 35 checks against a
frozen artifact, where a change in the number *is* the finding.

## Reading the evidence

Every claim this tool emits carries the standing of the evidence behind it, on
axes that are deliberately kept apart. The words are narrow on purpose.

**Did the catalog answer?** — `read`

| value | meaning |
| -- | -- |
| `ok` | the catalog answered; the values beside this are its answer |
| `failed` | it was asked and did not answer |
| `not-queried` | it was not asked |

`failed` and `not-queried` are not claims about the data. Collapsing them into
"no data" is the error the whole contract exists to prevent.

**Was the answer whole?** — `completeness`

| value | meaning |
| -- | -- |
| `complete-against-pinned-manifest` | compared against a named, pinned expected set and found equal to it |
| `not-established` | nothing determined whether the answer is whole |

A read can succeed and still be partial. DataHub's lineage is search-index
backed, and that index converges after ingest — so a query can return four edges
of twelve, succeed, and look identical to a complete answer.

**`not-established` is the honest and usually correct state, not a shortfall.**
It does not mean the answer is wrong or that someone forgot to check. It means
no attestation exists, which is true of every lineage read this repository
currently emits. The stronger value requires a pinned manifest of expected URNs
and matching digests; deriving those is tracked under
[HAC-231](https://linear.app/marcelle-labs/issue/HAC-231), and until it lands
nothing here claims it.

**Why is something missing?** — `unavailable[].reason`

`absent` is the strongest of these: asked, and reported nothing. It is only
sayable about an answer established complete against a pinned manifest, because
a converging index returning zero satisfies "asked and got nothing" while being
no evidence at all. When completeness is unknown, the honest word is
`indeterminate`.

**What backs a claim?** — `evidence.records[].checkExecuted` and the derived tier

`checkExecuted` records that this harness *ran* a check. It does not say the
claim is true — that is what the adjacent `observation` field records and what a
reviewer judges. The tier is a mechanical function of the records and is never
rendered alone: `VERIFIED` is a fact about records that reads as a warrant about
claims, so every surface shows it with the counts that produced it.

**Did the writeback land?** — the receipt

`bothStatesRead` says the before and after states were both read. It says
nothing about whether they show what was intended; `succeeded` says that, and
requires the mutations to have been accepted *and* the intended state to have
been observed. A mutation returning cleanly is not evidence that the write is
visible — DataHub serves stale reads for some seconds afterwards.

The full contract, including what each invariant refuses, is
[`src/integration/change-impact-event.ts`](src/integration/change-impact-event.ts).

## Local quickstart

See [`docs/quickstart.md`](docs/quickstart.md) for running a local DataHub instance and pointing this application at it.

## Status

Bootstrapped under [HAC-214](https://linear.app/marcelle-labs/issue/HAC-214).

Landed:

- [META-248](https://linear.app/marcelle-labs/issue/META-248) — the workspace.json DataHub/dbt adapter is adopted as an internal module, parity preserved at 35/35 against the frozen migration baseline. See [`docs/provenance.md`](docs/provenance.md).
- [HAC-143](https://linear.app/marcelle-labs/issue/HAC-143) — proof corpus frozen at [`dbt-labs/jaffle_shop_duckdb@36bde6cb`](https://github.com/dbt-labs/jaffle_shop_duckdb/tree/36bde6cba69d962b83be1d52fc65a0dce1cb4ebb). See [`evaluation/proof-corpus.md`](evaluation/proof-corpus.md), including its recorded limitations.
- [HAC-162](https://linear.app/marcelle-labs/issue/HAC-162) — `original_file_path` verified populated across every dbt node type the join uses. See [`evaluation/dbt-node-coverage.md`](evaluation/dbt-node-coverage.md).

Not yet resolved, gating further work:

- [HAC-213](https://linear.app/marcelle-labs/issue/HAC-213) — Path-B (`workspacejson signals datahub`) not yet ruled.
- [HAC-163](https://linear.app/marcelle-labs/issue/HAC-163) — agent substrate (build on the DataHub Analytics Agent/LangGraph vs. own) not yet decided; gates [HAC-148](https://linear.app/marcelle-labs/issue/HAC-148), [HAC-149](https://linear.app/marcelle-labs/issue/HAC-149), [HAC-152](https://linear.app/marcelle-labs/issue/HAC-152).

## License

Apache License 2.0 — see [`LICENSE`](LICENSE).
