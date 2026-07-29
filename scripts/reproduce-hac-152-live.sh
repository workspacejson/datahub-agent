#!/usr/bin/env bash
set -euo pipefail

# Produce a fresh HAC-152 package against an already-running local DataHub.
# This script writes only to a temporary directory and the explicitly selected
# local GMS instance. It never reads, prints, or persists a secret value.
#
# It requires this project's Doppler tenant, because the last step runs a paired
# LLM plan comparison. Most readers do not want that step and cannot run it.
#
# If you are here to rebuild the Transfermarkt demo corpus, you want
# `scripts/ingest-transfermarkt-corpus.sh` instead — same pinned corpus, same
# pinned tools, same ingest recipe, no credential of any kind.

repo_root="$(cd "$(dirname "$0")/.." && pwd)"

# Checked before anything is created, and answered with what to do rather than
# with a variable name. This used to be a bare `${VAR:?message}` on this line,
# which exits 1 before the clone for anyone outside the tenant — leaving a reader
# to conclude the evidence path is broken when in fact they are missing an input
# they were never told they needed, for a step they probably did not want.
if [ -z "${HAC152_QWEN_CONFIG:-}" ]; then
  cat >&2 <<'MSG'
reproduce-hac-152-live.sh needs HAC152_QWEN_CONFIG and did not find it.

This script rebuilds the full HAC-152 evidence package, and its final step runs a
paired plan comparison through an LLM. That step needs this project's private
Doppler tenant (`--project dev_week_26_openai`) and a funded `OPENAI_API_KEY2`.
Without them the run cannot complete, so it stops here rather than doing several
minutes of work first.

  You want the demo corpus, not the judge run:

      scripts/ingest-transfermarkt-corpus.sh --build-only   # no DataHub needed
      scripts/ingest-transfermarkt-corpus.sh                # build and ingest

  That is the same corpus at the same pin, the same pinned tools, and the same
  ingest recipe, with no credential required. It is the path to use if you are
  reproducing the evidence in evaluation/hac-152/.

  You are inside the tenant and do want the full package:

      export HAC152_QWEN_CONFIG=<doppler config name>

Nothing has been created or modified.
MSG
  exit 2
fi

run_dir="${HAC152_RUN_DIR:-$(mktemp -d /tmp/hac-152-live.XXXXXX)}"
gms="${HAC152_GMS:-http://localhost:8080}"
config="$HAC152_QWEN_CONFIG"
python_bin="${HAC152_PYTHON:-python3.11}"
urn='urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)'
revision='59fa295c51fc23466f3a71542f8bf3d1335daa83'
repository='https://github.com/dcaribou/transfermarkt-datasets'

command -v "$python_bin" >/dev/null
if [ ! -d "$repo_root/node_modules" ]; then
  npm ci --prefix "$repo_root"
fi

# Fail early only when the local GMS cannot answer a real GraphQL request.
curl -fsS --max-time 5 -X POST "$gms/api/graphql" \
  -H 'Content-Type: application/json' \
  --data '{"query":"{ appConfig { appVersion } }"}' >/dev/null

git clone "$repository" "$run_dir/transfermarkt"
git -C "$run_dir/transfermarkt" checkout --detach "$revision"
"$python_bin" -m venv "$run_dir/venv"
"$run_dir/venv/bin/pip" install 'acryl-datahub[dbt]==1.6.0.16' mcp-server-datahub dbt-duckdb
"$run_dir/venv/bin/dbt" deps --project-dir "$run_dir/transfermarkt/dbt" --profiles-dir "$run_dir/transfermarkt/dbt"
(cd "$run_dir/transfermarkt/dbt" && "$run_dir/venv/bin/dbt" docs generate --profiles-dir .)

printf '%s\n' \
  'source:' \
  '  type: dbt' \
  '  config:' \
  "    manifest_path: $run_dir/transfermarkt/dbt/target/manifest.json" \
  "    catalog_path: $run_dir/transfermarkt/dbt/target/catalog.json" \
  '    target_platform: duckdb' \
  '    git_info:' \
  "      repo: $repository" \
  "      branch: $revision" \
  'sink:' \
  '  type: datahub-rest' \
  '  config:' \
  "    server: $gms" > "$run_dir/dbt-recipe.yml"

DATAHUB_TELEMETRY_ENABLED=false "$run_dir/venv/bin/datahub" ingest -c "$run_dir/dbt-recipe.yml"
node "$repo_root/scripts/emit-change-impact-event.mjs" "$urn" --gms "$gms" \
  --mcp-command "$run_dir/venv/bin/mcp-server-datahub" --out "$run_dir/event.json" \
  --subject-repository "$repository" --subject-revision "$revision" \
  --workspace-artifact "$repo_root/test/fixtures/proof-corpus-transfermarkt/workspace.json"
node "$repo_root/scripts/run-writeback.mjs" "$run_dir/event.json" --gms "$gms" --out "$run_dir/event-with-writeback.json"
doppler run --project dev_week_26_openai --config "$config" -- \
  node --import tsx "$repo_root/scripts/run-paired-plan-comparison.mjs" \
  --event "$run_dir/event-with-writeback.json" --out "$run_dir/judge-run-bundle.json" \
  --task-id add-quality-check \
  --prompt 'Add a dbt quality check for game_events, preserving the declared lineage and recording the DataHub enrichment outcome without claiming success unless the intended state is observed.' \
  --settings '{"temperature":0}' --api-key-env OPENAI_API_KEY2
shasum -a 256 "$run_dir/event.json" "$run_dir/event-with-writeback.json" "$run_dir/judge-run-bundle.json"
printf 'HAC-152 artifacts: %s\n' "$run_dir"
