# Audit report — HAC-246: Independent lineage-oracle audit

> **Date:** 2026-07-31
> **Auditor:** Cascade (automated)
> **DataHub:** GMS v1.6.0 at `http://localhost:8080`

## Summary

Independent recomputation of Transfermarkt topology from the pinned dbt manifest produces **identical URN sets and digests** to the committed readiness manifests and the live DataHub observation. The oracle is independent: topology comes from `depends_on` / `parent_map` / `child_map` in the dbt manifest, not from DataHub's search index.

## Method

1. Checked out Transfermarkt corpus at pinned SHA `59fa295c51fc23466f3a71542f8bf3d1335daa83`
2. Installed pinned tools: `acryl-datahub[dbt]==1.6.0.16`, `dbt-duckdb==1.10.1`
3. Generated dbt manifest via `dbt docs generate`
4. Ran `scripts/derive-readiness-manifest.mjs` for both directions
5. Compared expected URN sets and digests against committed manifests and live DataHub

## Live evidence

### Independent derivation

| Direction | Expected URNs | Expected set digest | Manifest digest |
|-----------|--------------|-------------------|----------------|
| UPSTREAM (degree 4) | 8 | `888a1578dcf6048a...` | `770a1e8e46fc0f2f...` |
| DOWNSTREAM (degree 4) | 1 | `0bd210967c1a5c17...` | `125169f39fd1dfc3...` |

### Comparison with committed manifests

- Upstream digest `888a1578...` — **matches** `ingest-transfermarkt-corpus.sh` `EXPECTED_UPSTREAM_DIGEST`
- Downstream digest `0bd21096...` — **matches** `EXPECTED_DOWNSTREAM_DIGEST`
- Both digests match the committed readiness manifests in `evaluation/hac-231/`

### Comparison with live DataHub

- MCP `get_lineage`: 8 upstreams / 1 downstream — **count matches**
- Hop-semantics spike: GraphQL and MCP URN sets **MATCH** for both directions
- Catalog baseline: upstream set digest `888a1578...` — **matches** independent derivation

### Degree breakdown (upstream)

| Degree | Count | Sample URNs |
|--------|-------|-------------|
| 1 | 2 | `duckdb:duck.dev.base_game_events`, `duckdb:duck.dev.base_games` |
| 2 | 2 | `dbt:duck.dev.base_game_events`, `dbt:duck.dev.base_games` |
| 3 | 2 | `dbt:duck.transfermarkt_scraper.game_lineups`, `dbt:duck.transfermarkt_scraper.games` |
| 4 | 2 | `duckdb:duck.transfermarkt_scraper.game_lineups`, `duckdb:duck.transfermarkt_scraper.games` |

## Independence verification

- URN construction uses DataHub's documented mapping, not this project's join
- Topology derived from dbt manifest's `depends_on`/`parent_map`/`child_map` — not from DataHub's search index
- The derivation script (`derive-readiness-manifest.mjs`) reads the manifest only, no catalog consultation

## Verdict

**PASS** — Independent oracle confirms the Transfermarkt topology. Expected URN sets match both the committed manifests and the live DataHub observation. The oracle is genuinely independent (manifest-derived, not catalog-derived).
