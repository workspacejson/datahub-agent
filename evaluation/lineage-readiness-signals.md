# Lineage readiness signals — what DataHub actually exposes

Investigated 2026-07-29 against local quickstart GMS `v1.5.0.6`
(`d0fce948555c06b3083479d40e8fa270d156c71f`), 66 datasets ingested (33 dbt /
33 duckdb, transfermarkt corpus only).

Supports [HAC-241](https://linear.app/marcelle-labs/issue/HAC-241) and the
governance section of
[HAC-231](https://linear.app/marcelle-labs/issue/HAC-231).

## The rule this document exists to state

**If a gate built on any signal below ships before that signal has been observed
to change, it must fail toward `not-ready`, never toward ready.**

The MCL lag endpoint has only ever been observed reading `totalLag: 0` on this
instance. It has not been seen to go non-zero. A detector that has only ever
returned "clear" is not established to detect anything, and must not be trusted
to mean "go". This is not a hypothetical caution: a readiness gate that silently
always passes is strictly worse than no gate, because it converts an unchecked
read into an apparently-checked one.

Cheapest way to retire this caveat, at zero cost: sample the endpoint during
[HAC-145](https://linear.app/marcelle-labs/issue/HAC-145)'s clean-clone
reproduction. That run ingests against fresh state, so MCL traffic is
guaranteed, no catalog mutation is spent on the validation, and no committed
evidence is at risk. Re-ingesting the existing pinned corpus is *not* a
substitute — GMS skips emission for unchanged aspects, so an idempotent
re-ingest can produce little or no traffic, leave `totalLag` at zero throughout,
and read as confirmation when the run was actually inconclusive.

## Usable — MCL consumer lag

```
GET /openapi/operations/kafka/mcl/consumer/offsets?detailed=true
```

Served by GMS on the same base URL the emitter already holds. No Kafka admin
access, no `docker exec`, no separate credential.

```json
{"generic-mae-consumer-job-client":{"MetadataChangeLog_Versioned_v1":{
  "partitions":{"0":{"offset":448,"lag":0},
                "1":{"offset":586,"lag":0},
                "2":{"offset":453,"lag":0}},
  "metrics":{"maxLag":0,"medianLag":0,"totalLag":0,"avgLag":0}}}}
```

`generic-mae-consumer-job-client` is the consumer that writes the **search and
graph indices** — the same indices `searchAcrossLineage` reads. A companion
endpoint exists for the timeseries topic
(`/openapi/operations/kafka/mcl-timeseries/consumer/offsets`) and is not
relevant to lineage.

### Why `lag: 0` is stronger here than "consumed"

This deployment runs `ES_BULK_REFRESH_POLICY=WAIT_UNTIL`. Under that policy the
Elasticsearch/OpenSearch bulk request does not acknowledge until the written
changes have been made visible to search by a refresh. The consumer's offset
therefore advances *after* search visibility, not merely after receipt — so
`totalLag: 0` means consumed **and** indexed **and** refreshed.

**This is a deployment setting, not a guarantee of the API.** A judge running
against a differently-configured or managed DataHub may have a policy where
`lag: 0` means only "consumed", and a refresh interval still stands between the
consumer and search visibility. A probe must read or assume-conservatively, and
must not treat `lag: 0` as universally sufficient.

### Scope limits

- It is a **global** consumer signal, not per-URN. It reports that the index has
  caught up with everything produced, which is stronger than needed for a single
  dataset but is exactly the right question immediately after an ingest.
- It says nothing about whether the *ingest* produced the edges you expected. It
  answers "has the index caught up", not "are the edges correct".

## Usable, and this section previously said otherwise — ingestion execution requests

> **Correction 2026-07-29.** This section stated: *"CLI `datahub ingest` creates
> no execution request at all. There is nothing to poll."* **That is false**, and
> the conclusion drawn from it — that any design gating on `executionRequest`
> would be gating on an unrelated cron job — is false with it.
>
> Re-measured live against GMS `v1.5.0.6`. `listExecutionRequests` now returns 51
> requests, and they carry two distinct source types:
>
> ```
> SCHEDULED_INGESTION_SOURCE   FAILURE   x28
> CLI_INGESTION_SOURCE         SUCCESS   x2
> ```
>
> CLI ingests **do** create execution requests, typed `CLI_INGESTION_SOURCE`, and
> they are also reachable through `listIngestionSources` under a source named
> `[CLI] dbt`:
>
> ```
> [CLI] dbt   SUCCESS  2026-07-29T10:47:45.350Z   1206ms
> [CLI] dbt   SUCCESS  2026-07-29T10:39:03.034Z   1681ms
> [CLI] dbt   SUCCESS  2026-07-29T01:32:27.420Z  15617ms
> ```
>
> That last one is the run that produced this repository's readiness manifests.
> The 10:47:45Z one reintroduced `jaffle_shop`, matching that dataset's
> `lastIngested` of 10:47:46.528Z to within the ingest's own duration.
>
> **Why the original observation was probably accurate and the conclusion still
> wrong.** The instance held 11 requests then and holds 51 now, and the scheduled
> cron fires every 15 minutes — so the earlier sample was small and the CLI
> entries were either absent from it or lost among the failures, which currently
> outnumber them roughly fourteen to one in a single page. A survey that finds
> only one source type in a page dominated by another has established what that
> page contained, not what the endpoint reports. **Filter by
> `input.source.type` rather than reading the first page and generalising.**
>
> The rest of the original observation survives: the 15-minute `FAILURE` cron is
> real, and it is `datahub-documents` and `datahub-gc` — UI-managed sources
> unrelated to this project's path. Those are noise. The CLI entries are not.

`scripts/reproduce-hac-152-live.sh` line 49 runs the CLI:

```bash
DATAHUB_TELEMETRY_ENABLED=false "$run_dir/venv/bin/datahub" ingest -c "$run_dir/dbt-recipe.yml"
```

**Consequence for anything built on this document.** The environment's ingestion
history *is* recorded and timestamped, in the place this section said was empty.
That is worth knowing twice over:

* it is an audit trail for a catalog that has been observed changing without this
  project acting (HAC-248), which is how the correction was found at all;
* it may be a simpler readiness signal than the MCL offsets endpoint below —
  a completed `CLI_INGESTION_SOURCE` request is a fact about *this* ingest, where
  `totalLag: 0` is a fact about a shared queue. **HAC-241's shape should be
  revisited before anything is built on the offsets path**, since the reasoning
  that ruled this out was this section.

Neither signal is a completeness proof, and the ordering consequence at the foot
of this document is unchanged: `observeReadiness` already handles the cold-index
case correctly without either.

## Adjacent — a read that is not graph-index-backed

```
GET /openapi/v3/entity/dataset/{urn-encoded}/upstreamLineage
```

Returns the dataset's `upstreams` aspect directly from primary storage. DataHub
writes primary storage synchronously under `SYNC_PRIMARY` and the search/graph
indices asynchronously, so this read **does not touch the graph index** and does
not race it.

Verified live for `duck.dev.game_events`: returned both direct upstreams
(`base_game_events`, `base_games`) plus `fineGrainedLineages`, immediately.

Why this matters for HAC-231's independence argument: that issue correctly notes
`Dataset.relationships` is only a divergence alarm, because it is graph-index
backed like `searchAcrossLineage` and therefore shares a failure mode with the
thing under test. **This aspect read does not share that failure mode.** It is a
genuine independent cross-check *along the index-lag dimension*.

It is **not** independent for the topology-oracle question — it is still
DataHub's own store, so it cannot answer "was the expected set correct?". That
continues to require the pinned dbt manifest. It also returns direct (1-hop)
upstreams only, not multi-hop closure.

## Checked and found to hold nothing useful

| Surface | Result |
| -- | -- |
| `/health`, `/health/live`, `/health/detailed` | liveness only, no index state |
| `/config` | versions and feature flags; no consumer or index state |
| `/actuator/health` | 404 on this build |
| `/openapi/operations/elasticSearch/getTaskStatus` | status of explicit long-running ES reindex tasks (`restore-indices`), not normal MCL→index propagation |
| `/openapi/operations/consistency/entities/{urn}` | returned empty body for a known-good URN; not characterised further |
| Kafka consumer-group CLI inside the broker container | `ListGroups` failed against both advertised listeners; superseded by the GMS endpoint above, which needs no broker access |

## Ordering consequence

`src/integration/readiness.ts` (`observeReadiness`) already handles the
cold-index case correctly without any of this: unindexed edges mean observed ≠
expected, so it reports `not-ready` and keeps polling within its bound, and its
`no-expectation` branch refuses to let an empty manifest launder index lag into a
completeness claim.

**The MCL signal is therefore an efficiency win — gate precisely instead of
polling — not a correctness one.** Ship the manifest-based gate first; treat the
convergence probe as an optimisation to add once its detector has been
validated.
