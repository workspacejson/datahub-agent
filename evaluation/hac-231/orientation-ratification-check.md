# HAC-231 step 6 — independent orientation check (ratification evidence)

Captured: 2026-07-29T08:44:47Z · GMS v1.5.0.6 · tree at `1fbddae`

## Why this path

Rows 5–8 of the ratification table rest on one claim: the sibling edge between a
logical dbt node and its physical table **reverses orientation** between models and
sources. This check reads that orientation from
`GET /openapi/v3/entity/dataset/{urn}/upstreamLineage`, which is served from primary
storage under `SYNC_PRIMARY`.

That path is uncorrelated with **both** things the claim could otherwise be circular
against: it does not route through `derive-readiness-manifest.mjs`'s mapping code, and
it does not touch the graph index that `searchAcrossLineage` reads. It is a third
witness, not a re-run of either.

```
--- SUBJECT dbt:model game_events
    upstream -> urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.dev.base_game_events,PROD)
    upstream -> urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.dev.base_games,PROD)
--- duckdb:model base_games
    upstream -> urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.base_games,PROD)
--- dbt:model base_games
    upstream -> urn:li:dataset:(urn:li:dataPlatform:dbt,duck.transfermarkt_scraper.game_lineups,PROD)
    upstream -> urn:li:dataset:(urn:li:dataPlatform:dbt,duck.transfermarkt_scraper.games,PROD)
--- dbt:source games
    upstream -> urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.transfermarkt_scraper.games,PROD)
--- duckdb:source games
    upstreams: (no aspect - terminal)
```

## What this establishes, hop by hop

| hop | from | to | rule | confirmed |
| -- | -- | -- | -- | -- |
| deg 1 | `dbt:game_events` | `duckdb:base_games`, `duckdb:base_game_events` | rule 1 — model dep points at **target platform** | yes |
| deg 2 | `duckdb:base_games` | `dbt:base_games` | rule 2 — model sibling `duckdb:X <- dbt:X` | yes |
| deg 3 | `dbt:base_games` | `dbt:source games`, `dbt:source game_lineups` | rule 1 — **source** dep stays on **dbt** | yes |
| deg 4 | `dbt:source games` | `duckdb:source games` | rule 2 — source sibling **reverses** to `dbt:X <- duckdb:X` | yes |
| — | `duckdb:source games` | (terminal) | closure genuinely ends at degree 4 | yes |

**The asymmetry is real and it is not ambiguous.** A model's physical table has the
logical node upstream of it; a source's logical node has the physical table upstream
of it. That is the single most falsifiable claim in the table, and it holds in the
direction the derivation predicted.

The falsifying observation would have been either of: a source appearing on `duckdb`
before `dbt`, or the source pair matching the model pair's orientation. Neither occurs.

## Corroboration already on disk

`evaluation/hac-231/hop-semantics-gate.md` recorded platform **and** degree per URN,
captured before the derivation existed, across two further independent surfaces
(GraphQL `searchAcrossLineage` and MCP `get_lineage`). Both show sources on `dbt` at
degree 3 and `duckdb` at degree 4 — the same reversal, from graph-index-backed reads.

Three surfaces, one of them not graph-index-backed, all agreeing.

## Signing what is in the tree

The digest in the ratification table must be the digest the committed artifact carries,
or HAC-145 would consume something other than what was ratified. Compared, not
re-derived:

| manifest | committed `manifestDigest` | table | match |
| -- | -- | -- | -- |
| `game_events.upstream.json` | `770a1e8e46fc0f2fcdeb84b2f12decf2895c2182590fd3631f2a10f7972405d7` | same | yes |
| `game_events.downstream.json` | `125169f39fd1dfc3b1c8783c2db78db8dfdb63680c06eee2eb582cbdf51303ef` | same | yes |

Read from `git show HEAD:` as well as the working tree; both agree and the tree is clean.

## Standing limitation

This is evidence prepared for ratification, not the ratification. Per this issue's
governance an agent may run deterministic commands but may not be the sole witness of
the verdict. What is established here is that the orientation claim is independently
observable and was observed; the sign-off remains a human one.
