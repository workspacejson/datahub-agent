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
- Lineage read through MCP in both directions: 8 upstream and 1 downstream
  edge, each carrying its own read state and completeness.
- `qwen-plus` ran both conditions under the same task, prompt digest and
  temperature-zero settings, producing added, removed and constrained deltas.
- The writeback read tier `null` before, wrote `VERIFIED`, then observed
  `VERIFIED` after one bounded read. It did not write a source link because MCP
  did not expose a commit-pinned URL.

## Limitations

Both lineage reads succeeded — 8 upstream edges and 1 downstream edge — but
completeness in both directions is `not-established`. An observed count is not
an exhaustiveness claim, and nothing here promotes it to one.

An earlier capture of this same chain recorded `upstreams: read: failed`,
because it read lineage immediately after ingestion and DataHub's graph index
had not yet converged. The parser refused to read that shape as "zero
upstreams", which was correct. The reads here were taken after convergence.
That timing dependency is not fixed and is tracked in HAC-241; a run of
`reproduce-hac-152-live.sh` against a cold DataHub can still reproduce the
failed read.

This package does not claim corpus completeness, HAC-231 manifest ratification,
or a cold-reader witness.

## Reproduction

Start a local DataHub OSS quickstart, then run from a clean clone:

```bash
HAC152_QWEN_CONFIG=<your-qwen-config> \
  bash scripts/reproduce-hac-152-live.sh
```

The script checks out the exact public Transfermarkt revision in a temporary
directory, generates dbt metadata, ingests it into the local GMS, emits the
MCP event, observes the writeback, and calls Qwen through an OpenAI-compatible
endpoint using the `OPENAI_API_KEY` environment variable name only. It writes
new artifacts to a new temporary run directory and prints that path; it never
prints or stores a secret value.
