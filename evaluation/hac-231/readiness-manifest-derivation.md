# HAC-231 — derived readiness manifests, verified against the live catalog

Captured: 2026-07-29T04:15:21Z

Expected URNs derived from the pinned dbt manifest using DataHub's own
construction rules. The catalog is the comparison target only — no expected
URN is read out of DataHub. `expectedSetDigest == observedSetDigest` below is
therefore a reproduction, not an echo.

```
subject:     urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)
direction:   UPSTREAM  (to degree 4)
corpus:      https://github.com/dcaribou/transfermarkt-datasets@59fa295c
expected:    8 URNs
  degree 1: 2
    urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.dev.base_game_events,PROD)
    urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.dev.base_games,PROD)
  degree 2: 2
    urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.base_game_events,PROD)
    urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.base_games,PROD)
  degree 3: 2
    urn:li:dataset:(urn:li:dataPlatform:dbt,duck.transfermarkt_scraper.game_lineups,PROD)
    urn:li:dataset:(urn:li:dataPlatform:dbt,duck.transfermarkt_scraper.games,PROD)
  degree 4: 2
    urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.transfermarkt_scraper.game_lineups,PROD)
    urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.transfermarkt_scraper.games,PROD)
expectedSetDigest: 888a1578dcf6048aa1e8e031babac1d0f0db00538f8bb681a030dfe70b784dc6
manifestDigest:    770a1e8e46fc0f2fcdeb84b2f12decf2895c2182590fd3631f2a10f7972405d7

--- verification against http://localhost:8080 ---
observed:    8 URNs
expected but not observed: 0
observed but not expected: 0

MATCH — derived set reproduces the catalog exactly.
observedSetDigest: 888a1578dcf6048aa1e8e031babac1d0f0db00538f8bb681a030dfe70b784dc6

subject:     urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)
direction:   DOWNSTREAM  (to degree 4)
corpus:      https://github.com/dcaribou/transfermarkt-datasets@59fa295c
expected:    1 URNs
  degree 1: 1
    urn:li:dataset:(urn:li:dataPlatform:duckdb,duck.dev.game_events,PROD)
expectedSetDigest: 0bd210967c1a5c17de6d45d166c9f38ec934026a37579d49ab37292a7457c260
manifestDigest:    125169f39fd1dfc3b1c8783c2db78db8dfdb63680c06eee2eb582cbdf51303ef

--- verification against http://localhost:8080 ---
observed:    1 URNs
expected but not observed: 0
observed but not expected: 0

MATCH — derived set reproduces the catalog exactly.
observedSetDigest: 0bd210967c1a5c17de6d45d166c9f38ec934026a37579d49ab37292a7457c260
```
