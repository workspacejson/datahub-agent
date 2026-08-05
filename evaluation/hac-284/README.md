# HAC-284 — executed provenance, captured live

> **Type:** Evidence | **Status:** Current | **Scope:** Contract 1.4

Two artifacts, both produced against a live DataHub OSS quickstart at pinned GMS
`v1.5.0.6` on 2026-08-05. They exist because the defect this issue names is
invisible in a fixture that agrees with itself: the digests were always correct,
and that is exactly what kept the mislabel quiet.

## `live-1.4-event-mcp-transport.json`

Emitted with `--transport mcp` against a pinned readiness manifest:

```bash
node scripts/emit-change-impact-event.mjs \
  "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)" \
  --transport mcp \
  --readiness-manifest test/fixtures/readiness/game_events.upstream.json
```

The upstream verification block is the whole point:

```json
"declaredQueryParameters": {
  "surface": "searchAcrossLineage", "direction": "UPSTREAM", "maxDegree": 4, ...
},
"executedRead": {
  "transport": "mcp",
  "surface": "mcp:get_lineage",
  "parameters": { "surface": "mcp:get_lineage", "query": "*", "maxHops": 3, "maxResults": 50, "direction": "UPSTREAM" }
}
```

Under contract 1.3 this same run recorded only the first set, under a field name
every consumer read as the second. The observed set came from `mcp:get_lineage`
at three hops; the recorded parameters described `searchAcrossLineage` at
`maxDegree: 4`. An auditor rerunning them ran a query the event had not run.

The same emission over `--transport gms` produces
`observedSetDigest: 888a1578…` — **identical** to the MCP run. That is HAC-231's
hop-semantics finding holding, and it is why this was not caught by any check on
the numbers. The comparison was sound and the label was false.

## `live-1.4-event-with-receipt.json`

The golden nested fixture put through the writeback, so the receipt is captured
under **post-HAC-270 semantics**:

```
ok   createStructuredProperty  already defined; deployed definition reconciled
ok   upsertStructuredProperties
observation  settled after 1 read(s) in 36ms (bound 60000ms)
succeeded    true   noop=true   bothStatesRead=true
```

`already defined; deployed definition reconciled` is the sentence HAC-270 added.
Before it, `already defined` alone was reported as success, so a catalog whose
property definition disagreed with the evidence lattice was indistinguishable
from one that agreed. The receipt now rests on a read-back comparison rather
than on the mutation's own report.

`noop: true` because the tier was already present from an earlier run — the
writeback is idempotent and says so rather than reporting a second success.

## What these do not establish

Neither is a claim about DataHub in general. Both are one corpus on one pinned
GMS version, and the MCP/GraphQL set equality is a property of this lineage
shape, not a guarantee of the two surfaces. Re-measure before relying on it
elsewhere.
