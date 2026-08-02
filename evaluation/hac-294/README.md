# HAC-294 Jaffle Shop judge-run bundle

This package is a real run captured on 2026-07-31. It contains a Qwen paired
`JudgeRunBundle` for the Jaffle Shop `customers` dataset. Verify all bytes
with `shasum -a 256 -c SHA256SUMS` from this directory.

## What it establishes

- The subject is `urn:li:dataset:(urn:li:dataPlatform:dbt,jaffle_shop.customers,PROD)`.
- A corpus-matched workspace artifact resolved the exact producing source
  `models/customers.sql` at `36bde6cba69d962b83be1d52fc65a0dce1cb4ebb`.
- DataHub-only explicitly lacks the repository-relative source location.
- `qwen-plus` ran both conditions under the same task, prompt digest and
  temperature-zero settings, producing added, removed and constrained deltas.
- The bundle was validated by `validateBundle` (digest binding, shared run
  identity, evidence citations all checked) before being committed.

## Reproduction

The bundle was produced by running `scripts/run-paired-plan-comparison.mjs`
against the committed golden fixture `test/fixtures/golden/change-impact-event.root.json`
with `qwen-plus` via an OpenAI-compatible endpoint. The command was:

```bash
node --import tsx scripts/run-paired-plan-comparison.mjs \
  --event test/fixtures/golden/change-impact-event.root.json \
  --out evaluation/hac-294/jaffle-shop-judge-run-bundle.json \
  --task-id add-quality-check \
  --prompt 'Add a dbt quality check for customers, preserving the declared lineage and recording the DataHub enrichment outcome without claiming success unless the intended state is observed.' \
  --settings '{"temperature":0}' \
  --api-key-env OPENAI_API_KEY \
  --model qwen-plus \
  --base-url <OpenAI-compatible endpoint>
```

The API key is never read from a file or printed. The script invokes the model
twice (DataHub-only and joined), derives deltas from the two outputs, validates
the bundle, and writes it.
