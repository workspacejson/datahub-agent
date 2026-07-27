# Forge screen — measurement-corpus candidates

Phase-0 de-risking for [HAC-213](https://linear.app/marcelle-labs/issue/HAC-213)
and the follow-on to [HAC-143](https://linear.app/marcelle-labs/issue/HAC-143).
Run 2026-07-26. Reproduce with `node scripts/screen-corpus-candidates.mjs`.

## Why the forge, not `git log`

Pre-squash history survives on GitHub via `refs/pull/<n>/head`. A local clone
shows only the flattened result, so `git log` systematically under-reports
fix-follow and co-change signal on any squash-merging repository — which is most
well-run repositories.

This was established in the META-195 thread on 2026-07-10 and restated as a
selection rule:

> **Demo-repo constraint dissolves.** Merge-commit preservation is no longer
> required. Select the corpus on lineage quality and `patch_path` cardinality
> instead.

So the screen measures **merged PR count × multi-commit PR ratio** — the number
of PRs carrying a recoverable pre-squash sequence — not merge commits in a clone.

## Results

Sample = last 50 merged PRs per repository.

```text
repo                                      license      models mergedPR multi%  recover usable
-----------------------------------------------------------------------------------------------
elementary-data/dbt-data-reliability      Apache-2.0   37     785      64%     502     yes
brooklyn-data/dbt_artifacts               Apache-2.0   41     220      62%     136     yes
dbt-labs/dbt-utils                        Apache-2.0   51     398      32%     127     yes
dcaribou/transfermarkt-datasets           CC0-1.0      23     137      76%     104     yes
dbt-labs/dbt-project-evaluator            Apache-2.0   134    256      38%     97      yes
calogica/dbt-expectations                 Apache-2.0   12     132      56%     74      yes
Datavault-UK/automate-dv                  Apache-2.0   0      63       92%     58      yes
dbt-labs/dbt-audit-helper                 Apache-2.0   30     66       62%     41      yes
dbt-labs/jaffle_shop_duckdb               Apache-2.0   5      35       54%     19      yes
g0v/tw_campaign_finance                   MIT          4      4        25%     1       yes
SarahDelgadoMartin/curso_data_engineering NOASSERTION  44     39       5%      2       NO
bcodell/activity_schema_demo              NONE         16     2        50%     1       NO
```

The raw ranking is misleading on its own — see the disqualification below.

## Package vs pipeline — the screen's blind spot

Most of the top scorers are **dbt packages** (macro/test libraries), not data
pipelines. Two consequences:

- **`dbt-labs/dbt-utils` is disqualified.** All 51 of its "models" live under
  `integration_tests/`. They are fixtures, not a pipeline.
- **`Datavault-UK/automate-dv` is disqualified.** 0 models — macro-only, so
  there is no file to join a dataset URN to at all, despite the highest
  multi-commit ratio measured (92%).
- `dbt-data-reliability` (30 real models + 7 integration_tests) and
  `dbt_artifacts` (34 + 7) are genuine but are still observability packages.
  Ingesting a dbt *package* into a catalog as though it were a pipeline is not
  a legible DataHub demo.

Only **`dcaribou/transfermarkt-datasets`** is an actual data pipeline among the
high scorers.

## Recommendation — `dcaribou/transfermarkt-datasets`

Verified directly, not inferred from the screen:

| Property | Value |
| -- | -- |
| License | CC0-1.0 (public domain dedication) |
| Stars / activity | 458 · pushed 2026-07-11 · not archived |
| **History** | **1,077 commits, first commit 2019-08-04 — ~7 years** |
| PR head refs on forge | 145 |
| Merged PRs / multi-commit | 137 · **76%** (highest ratio of any *pipeline* candidate) |
| Recoverable sequences | ~104 |
| Models | 23 — real two-layer DAG: 11 `base/` over 2 source systems → 12 `curated/` |
| **Sources** | **10** (jaffle_shop has 0) |
| Tests | 97 |
| Adapter | **DuckDB** — `dbt/profiles.yml`, `path: duck.db` |
| **dbt project location** | **nested at `dbt/`** |

### It removes the incumbent corpus's biggest limitation

`evaluation/proof-corpus.md` limitation 1 states that jaffle_shop_duckdb's dbt
project sits at the repository root, so `projectPrefix` is `""` and the corpus
*never exercises the nested-project normalization that is the adapter's entire
reason to exist* — currently covered only by a perturbation test.

transfermarkt-datasets is nested at `dbt/`. Its manifest reports
`models/curated/game_events.sql`, which must normalize to
`dbt/models/curated/game_events.sql` to join. **The fix runs live on real data
instead of being simulated.**

### It is judge-runnable without data

The join needs `manifest.json`, and `dbt parse` produces one from project files
alone — no warehouse, no credentials, no scraped rows:

```console
$ cd dbt && dbt deps && DBT_PROFILES_DIR=. dbt parse
$ ls -la target/manifest.json
-rw-r--r--  1544448  target/manifest.json
```

Coverage on that manifest, zero nulls:

```console
  97 test   POPULATED
  23 model  POPULATED
  10 sources
  (explicit null check: empty — zero nulls)
```

It also makes HAC-162's source caveat testable on real data for the first time:
10 sources exist here, against 0 in the incumbent corpus.

## Proposed disposition

**Two corpora, each for the job it actually wins.**

| Role | Corpus | Rationale |
| -- | -- | -- |
| Join + demo | `dbt-labs/jaffle_shop_duckdb@36bde6cb` | 5 models fit on a slide; one-command rebuild; already frozen and tested |
| **Measurement** | **`dcaribou/transfermarkt-datasets`** | ~7 years history, 104 recoverable sequences, 10 sources, real pipeline |

Or **transfermarkt alone**, if a single corpus is preferred: it wins on every
axis except slide-simplicity, and it is the only candidate that exercises the
nested-project normalization for real.

**Not pinned yet.** Freezing it at an immutable commit is a decision for the
HAC-143 follow-on, and the measurement claim it would support remains blocked on
[META-195](https://linear.app/marcelle-labs/issue/META-195) — there is no
producer emitting `fileIndex` to measure. HEAD at screen time was
`59fa295c51fc23466f3a71542f8bf3d1335daa83`.
