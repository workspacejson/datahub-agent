# HAC-150 — repeated DataHub-only vs joined-context paired evaluation

Ten identical tasks run under two conditions, holding task, model, prompt, decoding settings, repository revision and DataHub snapshot constant. The context envelope is the only varying input.

## Finding

Across 10 controlled paired runs on the pinned corpus, the joined context supplied the exact revision in 10/10 runs and DataHub-only supplied it in 0/10.

## Experiment

| Field | Value |
| --- | --- |
| Pairs requested | 10 |
| Task | `add-quality-check` |
| Model | `qwen-plus` |
| Decoding settings | `{"temperature":0}` |
| Prompt digest | `sha256:d19f4d098fb3adf77a041805d853d3cea8218644ef95c2c647786ace4373e413` |
| Settings digest | `sha256:e4ff491169b8a9ea78518a7972422b5a24d5e3790e0d9a9e5cbfb384d9b621e0` |
| Event digest | `75a8ec70be7b422546fa324a88a8c0a5574fa27d738ef9a99e3b0d4f380ab501` |
| Exact source | `dbt/models/curated/game_events.sql` |
| Pinned revision | `59fa295c51fc23466f3a71542f8bf3d1335daa83` |
| Request timeout | 120000 ms |

## Outcomes

| Outcome | Pairs |
| --- | --- |
| Observed (both conditions parsed) | 10/10 |
| Partial (one condition failed) | 0/10 |
| Failed (both conditions failed) | 0/10 |

Denominators are the pairs **requested**. A failed run is reported as a failure, never excluded from the denominator.

## The six measures

| Measure | Result |
| --- | --- |
| Exact source only in joined | 10/10 |
| Exact revision only in joined | 10/10 |
| Refusal removed by join | 10/10 |
| Step sequencing changed | 10/10 |
| Writeback choice changed | 10/10 |
| Any file added by join | 10/10 |
| Any file removed by join | 0/10 |

## Run-to-run stability, per condition

| Condition | Observed | Distinct step sequences | Distinct step counts | Refusal present |
| --- | --- | --- | --- | --- |
| DataHub-only | 10/10 | 5 | 1 | 10/10 |
| Joined | 10/10 | 1 | 1 | 0/10 |

A distinct-sequence count above 1 means the condition did not produce an identical plan every time. That is the nondeterminism this evaluation exists to characterise.

## Within-pair invocation order

Order was counterbalanced by pair index: `counterbalanced-by-index: even pairs lead datahub-only, odd pairs lead joined`. A fixed order could not separate a condition effect from a position effect.

| Lead condition | Pairs assigned | Exact revision only in joined |
| --- | --- | --- |
| DataHub-only first | 5 | 5/5 |
| Joined first | 5 | 5/5 |

Denominators are the pairs **assigned** to each arm, fixed before any invocation. A sharp difference between arms means position mattered and the headline sentence must say so.

## Failures

None. Every invocation returned a parsable plan.

## Artifacts

| Artifact | File | Digest |
| --- | --- | --- |
| Manifest | `manifest.json` | (this file's subject) |
| Pair records | `pairs.json` | `sha256:00722fe4eaec64ff62930e046585026bef82bc96fa5dd635f252510101c09923` |
| Aggregate | `aggregate.json` | `sha256:2ec128bbc572594f1b205c6faecfa0bb6ff8e821e667ea921cb3b30c936d2e0a` |
| Raw model output | `raw/` | 20 file(s), digested in `manifest.json` |

## Reproduce

```
node --import tsx scripts/run-hac-150-evaluation.mjs --event evaluation/hac-152/live-qwen-judge-run-bundle.json --from-bundle --task-id add-quality-check --prompt <see experiment.prompt> --model qwen-plus --runs 10 --out-dir evaluation/hac-150 --settings '{"temperature":0}' --base-url https://dashscope-intl.aliyuncs.com/compatible-mode/v1
node scripts/summarise-hac-150.mjs --dir evaluation/hac-150
```

The API key is read from the environment named in `manifest.json` (`experiment.apiKeyEnv`) and is never written to any artifact.
