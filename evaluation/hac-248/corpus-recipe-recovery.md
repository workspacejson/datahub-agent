# The demo corpus recipe was recoverable, and one GC cycle from not being

Recorded 2026-07-29. Read-only recovery against the live instance, before any
teardown.

## What was missing

Nothing in this repository documented how the nested Transfermarkt corpus — 33
`dbt` and 33 `duckdb` datasets, the subject of every committed readiness
manifest — was ingested. `scripts/clean-quickstart-proof.sh` rebuilds
*jaffle_shop*, the regression corpus. The demo subject had no reachable recipe.

That made the running instance the only record of how the corpus came to exist,
which is the condition under which a teardown destroys something unrecoverable.

## Where it was found

DataHub's CLI keys its generated ingestion source by a hash of the pipeline, so
every `datahub ingest` of the same source type writes the **same** `[CLI] dbt`
source URN and overwrites that source's stored recipe in place.

So the source-level recipe describes only the most recent run. On this instance
it reads as jaffle:

```text
listIngestionSources -> [CLI] dbt -> config.recipe
  git_info.repo   https://github.com/dbt-labs/jaffle_shop_duckdb
  git_info.branch 36bde6cba69d962b83be1d52fc65a0dce1cb4ebb
  manifest_path   /tmp/hac145-audit/jaffle/target/manifest.json
```

The transfermarkt recipe that built the demo corpus was no longer there. It
survives one level down — each `executionRequest` retains the recipe it ran
with:

```text
dbt-2026_07_28-21_32_27-3ecyuy   SUCCESS  15,617ms  acryl-datahub 1.6.0.16
  manifest_path   /tmp/hac-152-live.5PoLx6/transfermarkt/dbt/target/manifest.json
  catalog_path    /tmp/hac-152-live.5PoLx6/transfermarkt/dbt/target/catalog.json
  target_platform duckdb
  git_info.repo   https://github.com/dcaribou/transfermarkt-datasets
  git_info.branch 59fa295c51fc23466f3a71542f8bf3d1335daa83
```

That history is not permanent either. `datahub-gc` runs
`execution_request_cleanup` with `keep_history_min_count: 10` and
`keep_history_max_days: 90`. Three runs is under the floor today; it is not a
guarantee.

`scripts/capture-catalog-baseline.mjs` now captures the per-run recipe rather
than only the run's outcome, with secret-shaped keys redacted before anything
reaches a file. Capturing the outcome alone records *that* the corpus was
ingested while losing *how* — the half that cannot be reconstructed from a
rebuilt instance.

## The 10:39Z and 10:47Z runs are explained

The catalog was observed moving without anyone on this project asking: 66
datasets and no jaffle at 08:44Z, 82 with jaffle at 11:53Z. Both intervening
runs carry `manifest_path: /tmp/hac145-audit/jaffle/...` and actor
`urn:li:corpuser:__datahub_system`.

It was a HAC-145 audit workflow ingesting jaffle into the shared instance. Not an
external process. The instance is shared between workflows that do not announce
themselves to each other, which is the same failure surface either way — a clean
rebuild concurrent with one of these runs would produce a polluted catalog and no
way to separate "the recipe is wrong" from "something else ingested".

## The recipe, rebuilt and verified

`scripts/ingest-transfermarkt-corpus.sh` carries the recovered recipe with the
secret gate and the LLM judge run removed. `--build-only` stops before touching
any catalog.

Verified 2026-07-29 from a clean clone, no DataHub consulted:

```text
=== cloning https://github.com/dcaribou/transfermarkt-datasets at 59fa295c… ===
=== installing pinned tools ===          acryl-datahub 1.6.0.16, dbt-duckdb 1.10.1
=== generating the dbt manifest ===      dbt=1.12.0, adapter duckdb=1.10.1
                                         Found 23 models, 97 data tests, 10 sources
=== checking derived lineage against the committed expectation ===
  UPSTREAM    matches 888a1578dcf6048aa1e8e031babac1d0f0db00538f8bb681a030dfe70b784dc6
  DOWNSTREAM  matches 0bd210967c1a5c17de6d45d166c9f38ec934026a37579d49ab37292a7457c260
```

The 23/97/10 counts reproduce `evaluation/corpus-forge-screen.md` exactly. Both
digests reproduce `test/fixtures/readiness/game_events.{upstream,downstream}.json`
exactly, and are derived from the dbt manifest by
`scripts/derive-readiness-manifest.mjs` — which refuses an unpinned checkout and
never reads an expected URN out of a catalog.

`dbt docs generate` writes `catalog.json` without `dbt run` or `dbt seed`, so the
build needs no warehouse and no scraped rows.

## What this does and does not establish

**Established.** The corpus, at its pin, with pinned tools, reproduces the exact
topology the committed manifests were frozen against, from a clean clone, with no
credential and no catalog.

**Not established.** That the *ingest* limb reproduces against a rebuilt DataHub.
That is deliberately left to the clean rebuild, where it is the rebuild's own
verification rather than an assumption the rebuild depends on. Until then, the
ingest limb is documented and unexercised.

**Also not established.** Stability. This is one build. It says the recipe worked
once, today, on this machine.
