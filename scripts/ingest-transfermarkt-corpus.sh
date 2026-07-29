#!/usr/bin/env bash
#
# Build and ingest the nested Transfermarkt corpus — the demo subject.
#
# ## Why this exists separately
#
# The commands that built this project's demo corpus already existed, inside
# `scripts/reproduce-hac-152-live.sh`. They were not reachable. That script's
# third line is:
#
#     config="${HAC152_QWEN_CONFIG:?set HAC152_QWEN_CONFIG to the Doppler ...}"
#
# which under `set -u` exits 1 before the clone, so anyone without this project's
# Doppler tenant cannot reach the corpus build at all — and having reached it,
# would still be running an LLM judge comparison they did not ask for. The corpus
# ingest was welded to a paid, credentialled, private-secret workflow.
#
# That matters beyond convenience. `scripts/clean-quickstart-proof.sh` rebuilds
# *jaffle_shop*, which is the regression corpus. Transfermarkt is the demo
# subject and the only corpus that exercises the nested-project normalization the
# adapter exists for. So the corpus a reader most wants to reproduce was the one
# they could not, and the gap was invisible because a clean-room proof script did
# exist — for the other corpus.
#
# This carries the same pinned commands with the secret gate and the judge run
# removed. Nothing here needs a credential, a paid API, or a private tenant.
#
# ## Two phases, because they fail for different reasons
#
#   build    clone at the pin, install pinned tools, generate the dbt manifest,
#            and check the derived lineage against the committed expectation.
#            Touches no DataHub. A judge with no catalog running can do this.
#
#   ingest   push that manifest into a DataHub instance.
#
# `--build-only` stops after the first. That split is deliberate: a build failure
# means the corpus or toolchain moved, an ingest failure means the catalog did,
# and collapsing them into one exit code loses which.
#
# ## What it refuses to do
#
# It does not create, destroy, or reset a DataHub. `--ingest` writes to whatever
# `--gms` names and nothing else. Teardown belongs to whoever owns the instance.
#
#   scripts/ingest-transfermarkt-corpus.sh --build-only
#   scripts/ingest-transfermarkt-corpus.sh --gms http://localhost:8080
#
# Environment:
#   CORPUS_WORKDIR   where the checkout and venv live (default: a fresh mktemp)
#   PYTHON311        path to a Python 3.11 (default: python3.11)

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

# The corpus pin. Recorded in evaluation/corpus-forge-screen.md and carried by
# test/fixtures/proof-corpus-transfermarkt/workspace-provenance.json.
CORPUS_URL=https://github.com/dcaribou/transfermarkt-datasets
CORPUS_PIN=59fa295c51fc23466f3a71542f8bf3d1335daa83

# Pinned, and asserted after install rather than assumed from a binary existing.
# 1.6.0.16 is the version recorded against the 2026-07-29T01:32:27Z ingest that
# built the corpus this repository's manifests were derived from — recovered from
# that run's execution request, not from recollection.
ACRYL_DATAHUB_VERSION=1.6.0.16
DBT_DUCKDB_VERSION=1.10.1

# The subject every committed readiness manifest is about, and the expectation
# the build phase must reproduce.
SUBJECT='urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)'
EXPECTED_UPSTREAM_DIGEST=888a1578dcf6048aa1e8e031babac1d0f0db00538f8bb681a030dfe70b784dc6
EXPECTED_DOWNSTREAM_DIGEST=0bd210967c1a5c17de6d45d166c9f38ec934026a37579d49ab37292a7457c260

GMS=http://localhost:8080
BUILD_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --gms) GMS="$2"; shift 2 ;;
    --build-only) BUILD_ONLY=1; shift ;;
    -h|--help) sed -n '2,50p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

WORK="${CORPUS_WORKDIR:-$(mktemp -d /tmp/transfermarkt-corpus.XXXXXX)}"
CORPUS="$WORK/transfermarkt"
VENV="$WORK/venv"
PYTHON311="${PYTHON311:-python3.11}"

# Both the CLI and the MCP server block on an outbound telemetry POST with
# retries. Disabled so timings here are the tool's, not a network's.
export DATAHUB_TELEMETRY_ENABLED=false
export DATAHUB_CLI_TELEMETRY_ENABLED=false

step="starting up"
on_error() {
  local code=$?
  echo >&2
  echo "######## TRANSFERMARKT CORPUS FAILED ########" >&2
  echo "  step     : $step" >&2
  echo "  exit     : $code" >&2
  echo "  workdir  : $WORK" >&2
  exit "$code"
}
trap on_error ERR

say() { step="$1"; printf '\n=== %s ===\n' "$1"; }

say "checking prerequisites"
command -v git >/dev/null
command -v "$PYTHON311" >/dev/null || {
  echo "No $PYTHON311 on PATH. Set PYTHON311 to a Python 3.11." >&2
  exit 2
}

say "cloning $CORPUS_URL at $CORPUS_PIN"
git clone --quiet "$CORPUS_URL" "$CORPUS"
git -C "$CORPUS" checkout --quiet --detach "$CORPUS_PIN"
# Assert the pin rather than trusting that checkout did what was asked.
actual_sha="$(git -C "$CORPUS" rev-parse HEAD)"
[ "$actual_sha" = "$CORPUS_PIN" ] || {
  echo "Checkout is at $actual_sha, expected $CORPUS_PIN" >&2
  exit 1
}

say "installing pinned tools"
"$PYTHON311" -m venv "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet \
  "acryl-datahub[dbt]==$ACRYL_DATAHUB_VERSION" \
  "dbt-duckdb==$DBT_DUCKDB_VERSION"

# Verified, not assumed. A pip resolution that quietly landed elsewhere would
# otherwise produce a manifest attributed to a version that never ran.
installed_datahub="$("$VENV/bin/datahub" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
[ "$installed_datahub" = "$ACRYL_DATAHUB_VERSION" ] || {
  echo "acryl-datahub resolved to '$installed_datahub', expected $ACRYL_DATAHUB_VERSION" >&2
  exit 1
}

say "generating the dbt manifest"
"$VENV/bin/dbt" deps --project-dir "$CORPUS/dbt" --profiles-dir "$CORPUS/dbt"
(cd "$CORPUS/dbt" && "$VENV/bin/dbt" docs generate --profiles-dir .)
[ -f "$CORPUS/dbt/target/manifest.json" ] || {
  echo "No manifest at $CORPUS/dbt/target/manifest.json after docs generate" >&2
  exit 1
}

say "checking derived lineage against the committed expectation"
# This is the part that makes the build phase a test rather than a build. The
# derivation reads the dbt manifest only — no catalog is consulted — so a digest
# match means the corpus and toolchain still reproduce the topology the committed
# manifests were frozen against. A mismatch means the corpus moved, the pin
# slipped, or a tool version changed the URN construction. It is never a reason
# to update the expectation here; that decision belongs to HAC-231's governance.
check_direction() {
  local direction="$1" expected="$2" out
  out="$WORK/derived.$direction.json"
  node "$REPO/scripts/derive-readiness-manifest.mjs" "$CORPUS" \
    --subject "$SUBJECT" --direction "$direction" --max-degree 4 --out "$out" >/dev/null
  local got
  got="$(node -e "process.stdout.write(require('$out')._provenance.expectedSetDigest)")"
  if [ "$got" != "$expected" ]; then
    echo "  $direction  MISMATCH" >&2
    echo "    expected $expected" >&2
    echo "    derived  $got" >&2
    return 1
  fi
  echo "  $direction  matches $expected"
}
check_direction UPSTREAM "$EXPECTED_UPSTREAM_DIGEST"
check_direction DOWNSTREAM "$EXPECTED_DOWNSTREAM_DIGEST"

if [ "$BUILD_ONLY" = "1" ]; then
  say "build-only: stopping before ingest"
  printf 'corpus     %s\n' "$CORPUS"
  printf 'manifest   %s\n' "$CORPUS/dbt/target/manifest.json"
  exit 0
fi

say "ingesting into $GMS"
# Fail early only when the target cannot answer a real GraphQL request, so an
# unreachable catalog is not reported as an ingest failure.
curl -fsS --max-time 5 -X POST "$GMS/api/graphql" \
  -H 'Content-Type: application/json' \
  --data '{"query":"{ appConfig { appVersion } }"}' >/dev/null

# Byte-identical in shape to the recipe recovered from the 01:32:27Z execution
# request that produced the committed manifests.
cat > "$WORK/dbt-recipe.yml" <<YAML
source:
  type: dbt
  config:
    manifest_path: $CORPUS/dbt/target/manifest.json
    catalog_path: $CORPUS/dbt/target/catalog.json
    target_platform: duckdb
    git_info:
      repo: $CORPUS_URL
      branch: $CORPUS_PIN
sink:
  type: datahub-rest
  config:
    server: $GMS
YAML

"$VENV/bin/datahub" ingest -c "$WORK/dbt-recipe.yml"

say "done"
printf 'corpus     %s\n' "$CORPUS"
printf 'recipe     %s\n' "$WORK/dbt-recipe.yml"
printf 'gms        %s\n' "$GMS"
echo
echo "The search index settles asynchronously. Confirm the topology with:"
echo "  node scripts/capture-catalog-baseline.mjs --gms $GMS"
