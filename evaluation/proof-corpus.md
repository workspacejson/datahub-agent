# Proof corpus — selected and frozen

> **Type:** Evidence | **Status:** Current | **Scope:** Corpus selection and freeze

Ruling for HAC-143. This
repository is **not** the proof corpus; it consumes the corpus as an external,
read-only input at an immutable commit. Nothing from the corpus is vendored.

## The pin

| Field | Value |
| -- | -- |
| Repository URL | https://github.com/dbt-labs/jaffle_shop_duckdb |
| **Immutable commit** | `36bde6cba69d962b83be1d52fc65a0dce1cb4ebb` |
| Default branch | `duckdb` (**not** `main` — `main` does not resolve in this repository) |
| Commit date | 2026-03-02 |
| Commit subject | Merge PR #91 — `modernize-tooling` |
| License | Apache-2.0 |
| Stars | 281 |
| Archived | no |

```bash
git clone https://github.com/dbt-labs/jaffle_shop_duckdb
cd jaffle_shop_duckdb
git checkout 36bde6cba69d962b83be1d52fc65a0dce1cb4ebb
```

## History depth

| Measure | Value |
| -- | -- |
| Commits reachable from the pin | 92 |
| First commit | 2021-03-30 |
| Last commit | 2026-03-02 |
| Span | ~5 years |
| Contributors | 26 |
| Tracked files at the pin | 36 |

**Honest assessment:** 92 commits over five years is *thin* for co-change and
fragility evidence. This is the corpus's weakest dimension and it was accepted
knowingly — see the trade-off below.

## Lineage quality

Measured from a real `dbt docs generate` run at the pinned commit
(dbt 1.12.0, dbt-duckdb 1.10.1):

```text
.nodes total          28
  model               5    (2 table, 3 view; all SQL)
  seed                3
  test                20
.sources              0
```

Two-layer lineage: three `staging/` models over three seeds, feeding two marts
(`customers`, `orders`). Small, but genuinely a DAG rather than a flat list.

## Generated manifest availability

**The repository does not ship `target/`.** `manifest.json` must be built:

```bash
python3 -m venv .venv && ./.venv/bin/pip install dbt-duckdb
DBT_PROFILES_DIR=. ./.venv/bin/dbt seed
DBT_PROFILES_DIR=. ./.venv/bin/dbt run
DBT_PROFILES_DIR=. ./.venv/bin/dbt docs generate
# -> target/manifest.json  (659 KB)
```

This runs entirely on DuckDB against a local file. **No warehouse, no
credentials, no network.** That is the single strongest property of this
corpus and the main reason it wins.

Committed fixtures derived from this run live in
`test/fixtures/proof-corpus/`, regenerable via
`scripts/build-corpus-fixture.mjs` (which refuses to run against an unpinned
checkout).

## Why it is legible in a judge-facing demonstration

- **Reproducible in one command, on any machine.** DuckDB means a judge can
  rebuild the exact manifest without provisioning Snowflake or Postgres. A demo
  a judge cannot re-run is a demo they must take on faith.
- **Small enough to read on a slide.** 5 models and 3 seeds fit in a single
  view; a reviewer can verify the join by eye rather than trusting a count.
- **Continuity of evidence.** These are the same five models used in the HAC-75
  join probe and in the adapter's own `join.nested.test.ts` fixtures. The
  measurement story does not restart on a new corpus.
- **Apache-2.0 and unarchived**, so it can be referenced without license
  friction from a public Apache-2.0 repository.

## Trade-off accepted, and the alternatives rejected

| Candidate | License | Reproducible | History | Verdict |
| -- | -- | -- | -- | -- |
| **`dbt-labs/jaffle_shop_duckdb`** | Apache-2.0 | DuckDB, no creds | 92 commits, shallow | **selected** |
| `dbt-labs/jaffle-shop` | **none** | — | active | **rejected — no license.** Unusable as a pinned corpus for a public Apache-2.0 repository. |
| `dbt-labs/jaffle-shop-classic` | Apache-2.0 | needs a real warehouse | archived 2024 | rejected — worse reproducibility *and* dead history |

Reproducibility and legibility were weighted above history depth, because a
judge-facing proof that cannot be independently re-run is worth less than a
shallow one that can.

## Known limitations — read before making claims from this corpus

These are properties of the corpus, recorded so that no downstream claim
overstates what it supports.

1. **The dbt project sits at the repository root**, so `projectPrefix` is `""`.
   This corpus therefore *never exercises the nested-project normalization that
   is the adapter's entire reason to exist*. The nested case is covered by a
   perturbation test that relocates the same real paths under a `dbt/` prefix
   (`nodes-join.integration.test.ts`), not by the corpus itself.
2. **No snapshots, no Python models, no sources.** See
   [`dbt-node-coverage.md`](dbt-node-coverage.md) — those node types are
   verified against a purpose-built probe, not against this corpus.
3. **Shallow history.** Any co-change or fragility figure computed from 92
   commits should be presented as illustrative, not as a strong statistical
   claim.
4. ~~**No real `workspace.json` producer run exists for this corpus yet.**~~
   **RESOLVED 2026-07-26.** `@workspacejson/cli` is published, so the committed
   `workspace.json` fixture is now a genuine `workspacejson generate` run
   against the pinned corpus — the same artifact a judge gets from the same
   public command:

   ```json
   "producer": "@workspacejson/cli@0.5.0",
   "file_count": 36
   ```

   Per-file values remain empty, but that is now the **producer's own ratified
   behavior** rather than a limitation of this fixture: `FileIndexEntry`
   declares every value field optional, and the producer deliberately withholds
   behavioral values. The distinction matters — the join exercises key
   membership against keys a real producer emitted, not against a file list this
   repository synthesized.

   Two tests pin it so it cannot silently regress: one asserts the fixture
   carries a real producer identity, the other that the producer excludes its
   own artifact from the index.

Limitation 1 is now the one that most constrains what this corpus demonstrates:
it cannot exercise the nested-project normalization at all. See
[`corpus-forge-screen.md`](corpus-forge-screen.md) for a measurement corpus that
does.
