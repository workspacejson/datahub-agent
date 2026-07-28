#!/usr/bin/env bash
#
# Clean-quickstart proof for HAC-148 / HAC-149.
#
# Destroys the local DataHub, rebuilds it from the official quickstart, ingests
# the pinned proof corpus, waits for the search index to settle, then runs the
# read path over the official MCP server followed by the writeback and the reset.
#
# It fails closed. Every step is checked, no failure is swallowed, and the
# claims at the end are asserted by `scripts/assert-proof.mjs` against the
# emitted JSON — not by reading this script's own console output. A proof that
# greps its transcript is checking the formatter, not the fact.
#
# WARNING: runs `datahub docker nuke`. Point it at a throwaway instance.
#
# Prerequisites: Docker, Python 3.11, Node, git, curl.
#
#   scripts/clean-quickstart-proof.sh
#
# Environment:
#   PROOF_WORKDIR   cache for the venv and corpus checkout (default <repo>/.proof)
#   PYTHON311       path to a Python 3.11 (default: python3.11)

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK="${PROOF_WORKDIR:-$REPO/.proof}"
# Artifacts live in a directory emptied before the run. A step that fails must
# never leave an earlier run's event where a later step can read it and call the
# run a success.
RUN="$WORK/run"
CORPUS="$WORK/jaffle_shop_duckdb"
VENV="$WORK/dh-venv"
LOG="$RUN/steps"

URN='urn:li:dataset:(urn:li:dataPlatform:dbt,jaffle_shop.main.customers,PROD)'
CORPUS_PIN=36bde6cba69d962b83be1d52fc65a0dce1cb4ebb
CORPUS_URL=https://github.com/dbt-labs/jaffle_shop_duckdb

# Pinned, and verified after install rather than assumed from a binary existing.
ACRYL_DATAHUB_VERSION=1.6.0.16
MCP_SERVER_VERSION=0.6.0
DBT_DUCKDB_VERSION=1.10.1
PYTHON311="${PYTHON311:-python3.11}"

# Both the CLI and the MCP server block on an outbound telemetry POST with
# retries. Disabled so the timings recorded here are the tool's, not a network's.
export DATAHUB_TELEMETRY_ENABLED=false
export DATAHUB_CLI_TELEMETRY_ENABLED=false

export PROOF_STARTED_AT
PROOF_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

step_name="starting up"
on_error() {
  local code=$?
  echo
  echo "############ PROOF FAILED ############"
  echo "step   : $step_name"
  echo "line   : ${BASH_LINENO[0]}"
  echo "status : $code"
  if [ -f "$LOG/$step_name.log" ]; then
    echo "--- last 40 lines ---"
    tail -40 "$LOG/$step_name.log"
  fi
  exit "$code"
}
trap on_error ERR

step() {
  step_name="$1"
  echo
  echo "############ $1 ############"
  echo
}

die() { echo "FAILED: $*" >&2; exit 1; }

# Run a command, keep its output, and preserve its exit status.
#
# `cmd | tail` reports tail's status, so a failing command inside a pipeline
# passes silently. This is the reason no step in this script pipes into tail.
run() {
  local label="$1"; shift
  mkdir -p "$LOG"
  local code=0
  "$@" > "$LOG/$label.log" 2>&1 || code=$?
  if [ "$code" -ne 0 ]; then
    echo "--- $label (exit $code) ---"
    tail -40 "$LOG/$label.log"
    return "$code"
  fi
  tail -"${PROOF_TAIL:-10}" "$LOG/$label.log"
}

gql() {
  curl -sS -m 15 -X POST http://localhost:8080/api/graphql \
    -H 'Content-Type: application/json' -d "$1"
}

# The same request with a longer ceiling, for the window where GMS is rebuilding
# the search index and answers slowly. Separate rather than raising `gql`'s bound
# everywhere: a slow answer is expected here and nowhere else.
gql_slow() {
  curl -sS -m 45 -X POST http://localhost:8080/api/graphql \
    -H 'Content-Type: application/json' -d "$1"
}

json_number() { sed -n 's/.*"'"$1"'":\([0-9]*\).*/\1/p'; }

# ---------------------------------------------------------------------------
step "0-preflight"
command -v docker >/dev/null || die "docker not found"
command -v git    >/dev/null || die "git not found"
command -v curl   >/dev/null || die "curl not found"
command -v node   >/dev/null || die "node not found"
command -v "$PYTHON311" >/dev/null || die "$PYTHON311 not found — set PYTHON311 to a Python 3.11"

python_version="$("$PYTHON311" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
[ "$python_version" = "3.11" ] || die "expected Python 3.11, got $python_version"
docker info >/dev/null 2>&1 || die "the Docker daemon is not running"
echo "docker  $(docker --version)"
echo "node    $(node --version)"
echo "python  $("$PYTHON311" --version 2>&1)"

# ---------------------------------------------------------------------------
step "1-clean-run-directory"
# Deleted rather than reused. Anything surviving here from an earlier run is
# indistinguishable from something this run produced.
rm -rf "$RUN"
mkdir -p "$RUN" "$LOG"
echo "run artifacts: $RUN (emptied)"

# ---------------------------------------------------------------------------
step "2-toolchain"
mkdir -p "$WORK"
[ -x "$VENV/bin/python" ] || "$PYTHON311" -m venv "$VENV"
run pip-install "$VENV/bin/pip" install --quiet --upgrade \
  "acryl-datahub[dbt]==$ACRYL_DATAHUB_VERSION" \
  "mcp-server-datahub==$MCP_SERVER_VERSION"

# Verified, not assumed. A `datahub` binary on PATH says nothing about which
# version it is, nor whether the dbt plugin's dependencies came with it — and
# the failure mode of guessing is an ingest that dies minutes later with
# "dbt is disabled due to a missing dependency: boto3".
installed_datahub="$("$VENV/bin/pip" show acryl-datahub | sed -n 's/^Version: //p')"
installed_mcp="$("$VENV/bin/pip" show mcp-server-datahub | sed -n 's/^Version: //p')"
[ "$installed_datahub" = "$ACRYL_DATAHUB_VERSION" ] \
  || die "acryl-datahub is $installed_datahub, expected $ACRYL_DATAHUB_VERSION"
[ "$installed_mcp" = "$MCP_SERVER_VERSION" ] \
  || die "mcp-server-datahub is $installed_mcp, expected $MCP_SERVER_VERSION"

# The dbt source itself must import. This is the check that `[dbt]` actually
# landed, rather than the extra having merely been typed into a pip argument.
"$VENV/bin/python" - <<'PY' || die "the dbt ingestion source is not usable in this venv"
import sys
try:
    import boto3  # noqa: F401  the dependency whose absence disables the dbt source
    from datahub.ingestion.source.dbt.dbt_core import DBTCoreSource  # noqa: F401
except Exception as error:
    print(f"dbt ingestion source unusable: {error!r}", file=sys.stderr)
    raise SystemExit(1)
print("dbt ingestion source importable")
PY

export PATH="$VENV/bin:$PATH"
echo "acryl-datahub      $installed_datahub"
echo "mcp-server-datahub $installed_mcp"

# ---------------------------------------------------------------------------
step "3-pinned-corpus"
[ -d "$CORPUS/.git" ] || run git-clone git clone --quiet "$CORPUS_URL" "$CORPUS"
git -C "$CORPUS" checkout --quiet --force "$CORPUS_PIN"
# Any local edit would silently change the manifest this proof is built from.
git -C "$CORPUS" clean -qfdx -e .venv
head_sha="$(git -C "$CORPUS" rev-parse HEAD)"
[ "$head_sha" = "$CORPUS_PIN" ] || die "corpus is at $head_sha, expected $CORPUS_PIN"
echo "corpus at $head_sha"

if [ ! -x "$CORPUS/.venv/bin/dbt" ]; then
  "$PYTHON311" -m venv "$CORPUS/.venv"
  run dbt-install "$CORPUS/.venv/bin/pip" install --quiet --upgrade "dbt-duckdb==$DBT_DUCKDB_VERSION"
fi
installed_dbt="$("$CORPUS/.venv/bin/pip" show dbt-duckdb | sed -n 's/^Version: //p')"
[ "$installed_dbt" = "$DBT_DUCKDB_VERSION" ] \
  || die "dbt-duckdb is $installed_dbt, expected $DBT_DUCKDB_VERSION"
echo "dbt-duckdb $installed_dbt"

# ---------------------------------------------------------------------------
step "4-build-manifest"
# Regenerated every run. A cached `target/` could have come from a different
# checkout, a different dbt, or a hand edit — and the manifest is the input the
# whole join is built on.
rm -rf "$CORPUS/target"
build_dbt() (
  cd "$CORPUS"
  export DBT_PROFILES_DIR="$CORPUS"
  "$CORPUS/.venv/bin/dbt" seed --quiet
  "$CORPUS/.venv/bin/dbt" run --quiet
  "$CORPUS/.venv/bin/dbt" docs generate --quiet
)
run dbt-build build_dbt
[ -f "$CORPUS/target/manifest.json" ] || die "dbt produced no manifest.json"
[ -f "$CORPUS/target/catalog.json" ] || die "dbt produced no catalog.json"
echo "manifest.json $(wc -c < "$CORPUS/target/manifest.json") bytes"
echo "catalog.json  $(wc -c < "$CORPUS/target/catalog.json") bytes"

# ---------------------------------------------------------------------------
step "5-nuke"
run nuke datahub docker nuke

# ---------------------------------------------------------------------------
step "6-quickstart"
PROOF_TAIL=6 run quickstart datahub docker quickstart

# ---------------------------------------------------------------------------
step "7-gms-ready"
ready=0
for i in $(seq 1 90); do
  if gql '{"query":"{ appConfig { appVersion } }"}' 2>/dev/null | grep -q appVersion; then
    ready=1
    echo "GMS ready after ~$((i * 10))s: $(gql '{"query":"{ appConfig { appVersion } }"}')"
    break
  fi
  sleep 10
done
[ "$ready" -eq 1 ] || die "GMS did not become ready within 900s"

# ---------------------------------------------------------------------------
step "8-instance-is-clean"
# Scoped to the two things this tool can write, which is the only sense in which
# "clean" is this tool's to claim.
run reset-dry node "$REPO/scripts/reset-writeback.mjs" "$URN" --dry-run \
  --out "$RUN/proof-precheck.json"
node -e '
const receipt = require(process.argv[1]);
if (receipt.before.linkUrl !== null || receipt.before.evidenceTier !== null) {
  console.error("the rebuilt instance already carries this tool metadata: " + JSON.stringify(receipt.before));
  process.exit(1);
}
console.log("nothing owned by this tool is present");
' "$RUN/proof-precheck.json"

# ---------------------------------------------------------------------------
step "9-ingest"
# `git_info` is what makes DataHub compute the commit-pinned externalUrl.
# Without it the catalog holds no source URL and the MCP-boundary finding cannot
# be observed at all.
cat > "$RUN/dbt-recipe.yml" <<EOF
source:
  type: dbt
  config:
    manifest_path: $CORPUS/target/manifest.json
    catalog_path: $CORPUS/target/catalog.json
    target_platform: duckdb
    git_info:
      repo: $CORPUS_URL
      branch: $CORPUS_PIN
sink:
  type: datahub-rest
  config:
    server: http://localhost:8080
EOF
run ingest datahub ingest -c "$RUN/dbt-recipe.yml"
# The exit status is necessary and not sufficient: the pipeline reports its own
# failure count in the summary and still exits cleanly in some configurations.
grep -q "Pipeline finished" "$LOG/ingest.log" || die "ingestion produced no pipeline summary"
if grep -qiE "Pipeline finished with [0-9]+ failures|finished with at least [0-9]+ failures" "$LOG/ingest.log"; then
  die "ingestion reported failures"
fi
grep -qE "produced [0-9]+ events" "$LOG/ingest.log" || die "ingestion produced no events"

# ---------------------------------------------------------------------------
step "10-subject-exists"
subject_check="$(gql '{"query":"{ dataset(urn:\"'"$URN"'\"){ urn properties { name } } }"}')"
echo "$subject_check"
echo "$subject_check" | grep -q '"urn"'  || die "the subject URN does not resolve after ingestion"
echo "$subject_check" | grep -q '"name"' || die "the subject resolves but carries no properties"

# ---------------------------------------------------------------------------
step "11-lineage-settles"
# `searchAcrossLineage` is search-index backed and returns zero for minutes after
# ingest while the graph already holds the edges. Two consecutive equal non-zero
# reads is the same shape of check `src/integration/readiness.ts` applies — and
# it is still not a completeness claim.
settled=0
previous=-1
consecutive_failures=0
# A read that does not complete is recorded and bounded, never ignored.
#
# The first version of this loop died on the first failed read. That is wrong in
# the other direction: GMS is rebuilding the search index at exactly this point,
# and a single request timing out under that load is the system working, not a
# broken instance — one 15s timeout killed an otherwise healthy run. Bounding the
# failures keeps the proof closed against a real outage while not failing on the
# condition it exists to wait for. Each failure is printed, so a run that limped
# to a settle cannot look like one that read cleanly throughout.
MAX_CONSECUTIVE_READ_FAILURES=4
for i in $(seq 1 80); do
  if ! total="$(gql_slow '{"query":"{ searchAcrossLineage(input:{urn:\"'"$URN"'\",direction:UPSTREAM,query:\"*\",start:0,count:50}){ total } }"}' | json_number total)"; then
    consecutive_failures=$((consecutive_failures + 1))
    echo "  lineage read failed (${consecutive_failures}/${MAX_CONSECUTIVE_READ_FAILURES} consecutive, ~$((i * 15))s)"
    if [ "$consecutive_failures" -ge "$MAX_CONSECUTIVE_READ_FAILURES" ]; then
      die "the lineage query failed $consecutive_failures times consecutively — the instance is not answering"
    fi
    previous=-1  # a gap in observation breaks the two-consecutive-reads chain
    sleep 15
    continue
  fi
  consecutive_failures=0
  total="${total:-0}"
  if [ "$total" -gt 0 ] && [ "$total" -eq "$previous" ]; then
    settled=1
    echo "settled at upstream_total=$total after ~$((i * 15))s (two consecutive equal reads)"
    break
  fi
  if [ $((i % 4)) -eq 0 ]; then echo "  converging: upstream_total=$total (~$((i * 15))s)"; fi
  previous="$total"
  sleep 15
done
[ "$settled" -eq 1 ] || die "lineage did not reach the settled condition within 1200s"

# ---------------------------------------------------------------------------
step "12-mcp-field-coverage"
run probe node "$REPO/scripts/probe-mcp-dataset-fields.mjs" "$URN"
grep -q "DROPPED AT THE MCP BOUNDARY: externalUrl" "$LOG/probe.log" \
  || die "the probe did not observe externalUrl dropped at the MCP boundary"

# ---------------------------------------------------------------------------
step "13-emit-over-mcp"
run emit-mcp node "$REPO/scripts/emit-change-impact-event.mjs" "$URN" \
  --transport mcp \
  --subject-repository "$CORPUS_URL" \
  --subject-revision "$CORPUS_PIN" \
  --workspace-artifact "$REPO/test/fixtures/proof-corpus/workspace.json" \
  --out "$RUN/proof-event-mcp.json"

# ---------------------------------------------------------------------------
step "14-emit-over-gms"
run emit-gms node "$REPO/scripts/emit-change-impact-event.mjs" "$URN" \
  --transport gms \
  --subject-repository "$CORPUS_URL" \
  --subject-revision "$CORPUS_PIN" \
  --workspace-artifact "$REPO/test/fixtures/proof-corpus/workspace.json" \
  --out "$RUN/proof-event-gms.json"

# ---------------------------------------------------------------------------
step "15-writeback"
run writeback node "$REPO/scripts/run-writeback.mjs" "$RUN/proof-event-mcp.json" \
  --out "$RUN/proof-enriched.json"

# ---------------------------------------------------------------------------
step "16-writeback-repeat"
run writeback-repeat node "$REPO/scripts/run-writeback.mjs" "$RUN/proof-event-mcp.json" \
  --out "$RUN/proof-enriched-2.json"

# ---------------------------------------------------------------------------
step "17-reset"
run reset node "$REPO/scripts/reset-writeback.mjs" "$URN" --out "$RUN/proof-reset.json"

# ---------------------------------------------------------------------------
step "18-reset-repeat"
run reset-repeat node "$REPO/scripts/reset-writeback.mjs" "$URN" --out "$RUN/proof-reset-2.json"

# ---------------------------------------------------------------------------
step "19-assertions"
# Read from the emitted JSON, not from anything printed above.
node "$REPO/scripts/assert-proof.mjs" --run-dir "$RUN" --urn "$URN"

echo
echo "############ PROOF PASSED ############"
echo "artifacts: $RUN"
echo
echo "Limits this proof does not overstate:"
echo "  - completeness remains not-established; no pinned expected set exists (HAC-231)"
echo "  - the writeback observation settled, so 'timed-out' is not demonstrated live"
echo "  - only the root corpus subject is exercised; the nested corpus is not"
