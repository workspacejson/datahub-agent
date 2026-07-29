# HAC-231 step 6 — independent orientation check (ratification evidence)

Captured: 2026-07-29T08:44:47Z · GMS `v1.5.0.6` · **ingestion `acryl-datahub 1.6.0.16`** · tree at `1fbddae`

The ingestion version is load-bearing here, not incidental metadata. The claim under
review is about the orientation logic in `dbt_common.py:1173-1206` **of that version**.
That logic is a dependency on someone else's code: if it changes, this evidence stops
describing reality, and nothing else in this document would reveal that. Any re-reading
of this record must first confirm the ingestion version still matches.

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
    upstreams: (no upstreamLineage aspect returned — see caveat below)
```

## What this establishes, hop by hop

| hop | from | to | rule | confirmed |
| -- | -- | -- | -- | -- |
| deg 1 | `dbt:game_events` | `duckdb:base_games`, `duckdb:base_game_events` | rule 1 — model dep points at **target platform** | yes |
| deg 2 | `duckdb:base_games` | `dbt:base_games` | rule 2 — model sibling `duckdb:X <- dbt:X` | yes |
| deg 3 | `dbt:base_games` | `dbt:source games`, `dbt:source game_lineups` | rule 1 — **source** dep stays on **dbt** | yes |
| deg 4 | `dbt:source games` | `duckdb:source games` | rule 2 — source sibling **reverses** to `dbt:X <- duckdb:X` | yes |
| — | `duckdb:source games` | (no aspect returned) | consistent with the manifest's expectation that the closure ends at degree 4 | see below |

**The asymmetry is real and it is not ambiguous.** A model's physical table has the
logical node upstream of it; a source's logical node has the physical table upstream
of it. That is the single most falsifiable claim in the table, and it holds in the
direction the derivation predicted.

The falsifying observation would have been either of: a source appearing on `duckdb`
before `dbt`, or the source pair matching the model pair's orientation. Neither occurs.

## What the absent aspect does and does not establish

`duckdb:source games` returned no `upstreamLineage` aspect. **That is not proof of
termination, and this record must not read it as such.** An absent aspect, an empty
one, and one not yet written produce the same response — which is precisely the
conflation HAC-241 exists to name. Treating it as "the closure genuinely ends here"
would put the exact inference the manifest exists to prevent into the manifest's own
ratification record.

What is actually established is narrower and is enough: **the manifest expected degree
4 to be terminal, and the observation is consistent with that expectation.** The
expectation came first, from the derivation; the observation did not contradict it.
That is a consistency check against a prior claim, not an independent discovery of
termination.

The stronger statement — that nothing lies beyond degree 4 — rests on the dbt manifest,
where `source.transfermarkt_datasets.transfermarkt_scraper.games` declares no
dependencies and no node depends on the duckdb table beneath it. That is a property of
the pinned corpus, verifiable without asking DataHub anything.

## Corroboration already on disk

`evaluation/hac-231/hop-semantics-gate.md` recorded platform **and** degree per URN,
captured before the derivation existed, across two further independent surfaces
(GraphQL `searchAcrossLineage` and MCP `get_lineage`). Both show sources on `dbt` at
degree 3 and `duckdb` at degree 4 — the same reversal, from graph-index-backed reads.

Three surfaces, one of them not graph-index-backed, all agreeing.

## Why the evidence is upstream-heavy when both digests are being signed

The downstream manifest carries exactly one edge, `dbt:game_events → duckdb:game_events`.
That is **the model-sibling rule — the same rule, and the same line of code, already
confirmed at upstream degree 2** by `duckdb:base_games → dbt:base_games`. It needs no
separate line of argument, because a second instance of a rule tests the same
transcription rather than a new claim.

Read the same way, for completeness rather than because it was in doubt:

```
duckdb:game_events  upstream -> urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)
```

Orientation as predicted. The downstream digest is therefore signed on the same
evidence as upstream degree 2, not on a thinner basis.

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

## Note on this transcript

The `upstreams:` lines in the captured block are this check's own rendering of the API
response, not verbatim API output. One of those labels originally read `terminal`,
which asserted the very inference the caveat above rejects; it was reworded to describe
what was returned rather than what it was taken to mean. The underlying responses are
unchanged and the check is re-runnable against the same instance.
