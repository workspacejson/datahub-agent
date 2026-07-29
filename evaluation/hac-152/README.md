# HAC-152 live evidence package

This package is a real, local run captured on 2026-07-29. It contains a fresh
official-MCP event, the event after a real observed DataHub writeback, and a
Qwen paired `JudgeRunBundle`. Verify all bytes with `shasum -a 256 -c
SHA256SUMS` from this directory.

## What it establishes

- The subject is `urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)`.
- A corpus-matched workspace artifact resolved the exact producing source
  `dbt/models/curated/game_events.sql` at
  `59fa295c51fc23466f3a71542f8bf3d1335daa83`.
- DataHub-only explicitly lacks the repository-relative source location.
- `qwen-plus` ran both conditions under the same task, prompt digest and
  temperature-zero settings, producing added, removed and constrained deltas.
- The writeback read tier `null` before, wrote `VERIFIED`, then observed
  `VERIFIED` after one bounded read. It did not write a source link because MCP
  did not expose a commit-pinned URL.

## Limitations

Both lineage reads failed because the official MCP server returned no
`searchResults` array. `upstreams` and `downstreams` are therefore empty only
as payload shape: their observations are `read: failed` and completeness is
`not-established`. This package does not claim zero lineage, corpus
completeness, HAC-231 manifest ratification, or a cold-reader witness.

## Reproduction

Start a local DataHub OSS quickstart, then run from a clean clone:

```bash
HAC152_QWEN_CONFIG=prd_qwen_hackathon_26 \
  bash scripts/reproduce-hac-152-live.sh
```

The script checks out the exact public Transfermarkt revision in a temporary
directory, generates dbt metadata, ingests it into the local GMS, emits the
MCP event, observes the writeback, and calls Qwen through Doppler using the
OpenAI-compatible `OPENAI_API_KEY2` name only. It writes new artifacts to a
new temporary run directory and prints that path; it never prints or stores a
secret value.
