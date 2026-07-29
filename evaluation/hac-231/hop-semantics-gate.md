# HAC-231 kill-switch gate — hop semantics reproducibility

Captured: 2026-07-29T03:49:04Z
GMS: v1.5.0.6 (quickstart) | catalog: 66 datasets (33 dbt / 33 duckdb), transfermarkt only
MCL consumer lag at capture: {'maxLag': 0, 'medianLag': 0, 'totalLag': 0, 'avgLag': 0}

```
=== HAC-231 spike: hop semantics reproducibility ===
timestamp:    2026-07-29T03:49:04.391Z
gms:          http://localhost:8080
gms version:  v1.5.0.6
transport:    both
mcp command:  /tmp/hac-152-live.5PoLx6/venv/bin/mcp-server-datahub
urns:         1

========================================================================
subject: urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)

--- UPSTREAM ---

  GraphQL searchAcrossLineage (no degree filter) (8 edges):
    degree 1: 2 edges  [duckdb:2]
      duckdb   urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.dev.base_game_events,PROD)
      duckdb   urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.dev.base_games,PROD)
    degree 2: 2 edges  [dbt:2]
      dbt      urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.base_game_events,PROD)
      dbt      urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.base_games,PROD)
    degree 3: 2 edges  [dbt:2]
      dbt      urn:li:dataset:(urn:li:dataPlatform:dbt,duck.transfermarkt_scraper.game_lineups,PROD)
      dbt      urn:li:dataset:(urn:li:dataPlatform:dbt,duck.transfermarkt_scraper.games,PROD)
    degree 4: 2 edges  [duckdb:2]
      duckdb   urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.transfermarkt_scraper.game_lineups,PROD)
      duckdb   urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.transfermarkt_scraper.games,PROD)

  MCP get_lineage (max_hops=3) (8 edges):
    degree 1: 2 edges  [duckdb:2]
      duckdb   urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.dev.base_game_events,PROD)
      duckdb   urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.dev.base_games,PROD)
    degree 2: 2 edges  [dbt:2]
      dbt      urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.base_game_events,PROD)
      dbt      urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.base_games,PROD)
    degree 3: 2 edges  [dbt:2]
      dbt      urn:li:dataset:(urn:li:dataPlatform:dbt,duck.transfermarkt_scraper.game_lineups,PROD)
      dbt      urn:li:dataset:(urn:li:dataPlatform:dbt,duck.transfermarkt_scraper.games,PROD)
    degree 4: 2 edges  [duckdb:2]
      duckdb   urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.transfermarkt_scraper.game_lineups,PROD)
      duckdb   urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.transfermarkt_scraper.games,PROD)

  set comparison:
    GraphQL:  8 URNs
    MCP:      8 URNs
    both:     8 URNs
    SETS MATCH

--- DOWNSTREAM ---

  GraphQL searchAcrossLineage (no degree filter) (1 edges):
    degree 1: 1 edges  [duckdb:1]
      duckdb   urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.dev.game_events,PROD)

  MCP get_lineage (max_hops=3) (1 edges):
    degree 1: 1 edges  [duckdb:1]
      duckdb   urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.dev.game_events,PROD)

  set comparison:
    GraphQL:  1 URNs
    MCP:      1 URNs
    both:     1 URNs
    SETS MATCH

========================================================================
VERDICT: sets match between GraphQL and MCP surfaces.
Hop semantics are reproducible — derivation can proceed.

query parameters recorded:
  GraphQL:  { surface: "searchAcrossLineage", query: "*", start: 0, count: 50 }
  MCP:      { surface: "mcp:get_lineage", max_hops: 3, max_results: 50, query: "*" }
  note:     MCP max_hops=3 maps to degree filter ["1","2","3+"] — degree 4 collapses into "3+"
```
