#!/usr/bin/env bash
# Clean-quickstart proof for HAC-148 / HAC-149.
#
# Nukes the local DataHub, brings it back from the official quickstart, ingests
# the pinned proof corpus, waits for the search index to converge, then runs the
# read path over the official MCP server followed by the writeback and reset.
set -uo pipefail

HERE="${PROOF_WORKDIR:-$(cd "$(dirname "$0")/.." && pwd)/.proof}"
mkdir -p "$HERE"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
CORPUS="$HERE/jaffle_shop_duckdb"
URN='urn:li:dataset:(urn:li:dataPlatform:dbt,jaffle_shop.main.customers,PROD)'
PIN=36bde6cba69d962b83be1d52fc65a0dce1cb4ebb
export PATH="${DATAHUB_VENV:-$HERE/dh-venv}/bin:$PATH"
# The DataHub CLI and the MCP server both block on an outbound telemetry POST
# with retries. Disabled for the whole proof so the timings recorded here are
# the tool's, not a network's.
export DATAHUB_TELEMETRY_ENABLED=false
export DATAHUB_CLI_TELEMETRY_ENABLED=false

step() { echo; echo "############ $* ############"; echo; }

gql() { curl -s -m 10 -X POST http://localhost:8080/api/graphql -H 'Content-Type: application/json' -d "$1"; }
lineage_total() {
  gql '{"query":"{ searchAcrossLineage(input:{urn:\"'"$URN"'\",direction:UPSTREAM,query:\"*\",start:0,count:50}){ total } }"}' \
    | sed -n 's/.*"total":\([0-9]*\).*/\1/p'
}

step "0a. bootstrap the toolchain and the pinned corpus"
# Everything this proof needs, from nothing. Idempotent: re-running reuses what
# is already built rather than rebuilding it.
PY311="${PYTHON:-python3}"
if [ ! -x "${DATAHUB_VENV:-$HERE/dh-venv}/bin/datahub" ]; then
  "$PY311" -m venv "${DATAHUB_VENV:-$HERE/dh-venv}"
  "${DATAHUB_VENV:-$HERE/dh-venv}/bin/pip" install --quiet --upgrade pip
  # The [dbt] extra is required. Without it `datahub ingest` fails the recipe
  # with "dbt is disabled due to a missing dependency: boto3" — only when you
  # try to ingest, long after the quickstart has succeeded.
  "${DATAHUB_VENV:-$HERE/dh-venv}/bin/pip" install --quiet 'acryl-datahub[dbt]' mcp-server-datahub
fi
if [ ! -d "$CORPUS/.git" ]; then
  git clone --quiet https://github.com/dbt-labs/jaffle_shop_duckdb "$CORPUS"
fi
git -C "$CORPUS" checkout --quiet "$PIN"
if [ ! -x "$CORPUS/.venv/bin/dbt" ]; then
  "$PY311" -m venv "$CORPUS/.venv"
  "$CORPUS/.venv/bin/pip" install --quiet --upgrade pip
  "$CORPUS/.venv/bin/pip" install --quiet 'dbt-duckdb==1.10.1'
fi
if [ ! -f "$CORPUS/target/manifest.json" ]; then
  ( cd "$CORPUS" && DBT_PROFILES_DIR="$CORPUS" "$CORPUS/.venv/bin/dbt" seed --quiet \
    && DBT_PROFILES_DIR="$CORPUS" "$CORPUS/.venv/bin/dbt" run --quiet \
    && DBT_PROFILES_DIR="$CORPUS" "$CORPUS/.venv/bin/dbt" docs generate --quiet )
fi
echo "corpus at $(git -C "$CORPUS" rev-parse HEAD)"
ls -1 "$CORPUS/target/manifest.json" "$CORPUS/target/catalog.json"

step "0. versions"
docker --version
datahub version 2>&1 | head -3
pip show mcp-server-datahub 2>/dev/null | head -2
node --version

step "1. datahub docker nuke"
datahub docker nuke 2>&1 | tail -4

step "2. datahub docker quickstart"
datahub docker quickstart 2>&1 | tail -8

step "3. wait for GMS"
for i in $(seq 1 90); do
  if gql '{"query":"{ appConfig { appVersion } }"}' | grep -q appVersion; then
    echo "GMS ready after ~$((i*10))s"
    gql '{"query":"{ appConfig { appVersion } }"}'; echo
    break
  fi
  sleep 10
done

step "4. confirm the instance is empty of this tool's metadata"
node "$REPO/scripts/reset-writeback.mjs" "$URN" --dry-run 2>&1 | tail -8

step "5. ingest the pinned corpus"
# git_info is what makes DataHub compute the commit-pinned externalUrl. Without
# it the catalog holds no source URL at all, and the MCP-boundary finding cannot
# be observed — the probe correctly refuses to measure rather than reporting the
# gap closed.
cat > "$HERE/dbt-recipe.yml" <<EOF
source:
  type: dbt
  config:
    manifest_path: $CORPUS/target/manifest.json
    catalog_path: $CORPUS/target/catalog.json
    target_platform: duckdb
    git_info:
      repo: https://github.com/dbt-labs/jaffle_shop_duckdb
      branch: $PIN
sink:
  type: datahub-rest
  config:
    server: http://localhost:8080
EOF
cat "$HERE/dbt-recipe.yml"
datahub ingest -c "$HERE/dbt-recipe.yml" 2>&1 | grep -E "Pipeline finished|produced|failures|warnings" | tail -4

step "6. wait for the lineage search index to converge"
# `searchAcrossLineage` is search-index backed and returns zero for some minutes
# after ingest while the graph already holds the edges. Two consecutive equal
# non-zero reads, which is the same shape of check `src/integration/readiness.ts`
# applies — and is still not a completeness claim.
prev=-1; stable=0
for i in $(seq 1 60); do
  t=$(lineage_total); t=${t:-0}
  if [ "$t" -gt 0 ] && [ "$t" -eq "$prev" ]; then
    stable=1; echo "settled at upstream_total=$t after ~$((i*15))s (two consecutive equal reads)"; break
  fi
  [ $((i % 4)) -eq 0 ] && echo "  converging: upstream_total=$t (~$((i*15))s)"
  prev=$t; sleep 15
done
[ "$stable" -eq 1 ] || echo "DID NOT SETTLE — the lineage read below is under a still-converging index"
gql '{"query":"{ dataset(urn:\"'"$URN"'\"){ graphEdges: relationships(input:{types:[\"DownstreamOf\"],direction:OUTGOING,start:0,count:50}){ total } } }"}'; echo

step "7. MCP field-coverage probe (independent of the read path)"
node "$REPO/scripts/probe-mcp-dataset-fields.mjs" "$URN" 2>&1 | tail -22
echo "probe exit: $?"

step "8. emit over the OFFICIAL MCP SERVER"
node "$REPO/scripts/emit-change-impact-event.mjs" "$URN" \
  --transport mcp \
  --subject-repository https://github.com/dbt-labs/jaffle_shop_duckdb \
  --subject-revision "$PIN" \
  --workspace-artifact "$REPO/test/fixtures/proof-corpus/workspace.json" \
  --out "$HERE/proof-event-mcp.json" 2>&1 | tail -12
echo "emit exit: $?"

step "9. emit over DIRECT GMS GraphQL, for comparison"
node "$REPO/scripts/emit-change-impact-event.mjs" "$URN" \
  --transport gms \
  --subject-repository https://github.com/dbt-labs/jaffle_shop_duckdb \
  --subject-revision "$PIN" \
  --workspace-artifact "$REPO/test/fixtures/proof-corpus/workspace.json" \
  --out "$HERE/proof-event-gms.json" 2>&1 | tail -10
echo "emit exit: $?"

step "10. what the two transports agree and disagree on"
node -e '
const a = require("'"$HERE"'/proof-event-mcp.json"), b = require("'"$HERE"'/proof-event-gms.json");
const set = (e, k) => e.datahub[k].map((x) => x.urn).sort();
console.log("upstream URN sets equal :", JSON.stringify(set(a,"upstreams")) === JSON.stringify(set(b,"upstreams")), "(" + a.datahub.upstreams.length + " edges)");
console.log("downstream URN sets equal:", JSON.stringify(set(a,"downstreams")) === JSON.stringify(set(b,"downstreams")), "(" + a.datahub.downstreams.length + " edges)");
console.log("schemaFieldCount        :", a.datahub.schemaFieldCount, "/", b.datahub.schemaFieldCount);
console.log("code.sourceUrl          :", JSON.stringify(a.code.sourceUrl), "/", JSON.stringify(b.code.sourceUrl));
console.log("gmsVersion              :", JSON.stringify(a.provenance.datahub.gmsVersion), "/", JSON.stringify(b.provenance.datahub.gmsVersion));
console.log("mcp unavailable         :", a.unavailable.map((u) => u.field + "/" + u.reason).join(", "));
console.log("gms unavailable         :", b.unavailable.map((u) => u.field + "/" + u.reason).join(", "));
const nameDiff = a.datahub.upstreams.filter((e, i) => e.name !== b.datahub.upstreams[i]?.name);
console.log("edge names differing    :", nameDiff.length, nameDiff.map((e) => e.urn.split(",")[1]).join(" "));
'

step "11. writeback from a genuinely clean catalog"
node "$REPO/scripts/run-writeback.mjs" "$HERE/proof-event-mcp.json" \
  --out "$HERE/proof-enriched.json" 2>&1 | tail -11
echo "writeback exit: $?"

step "12. writeback again — idempotency shows as noop"
node "$REPO/scripts/run-writeback.mjs" "$HERE/proof-event-mcp.json" \
  --out "$HERE/proof-enriched-2.json" 2>&1 | tail -5

step "13. the five outcome facts, as distinguishable receipt fields"
node -e '
const w = require("'"$HERE"'/proof-enriched.json").writeback;
const n = require("'"$HERE"'/proof-enriched-2.json").writeback;
console.log("eventVersion         :", require("'"$HERE"'/proof-enriched.json").eventVersion);
console.log("success              : succeeded=" + w.succeeded + " noop=" + w.noop);
console.log("noop (2nd run)       : succeeded=" + n.succeeded + " noop=" + n.noop);
console.log("refusal              : refusedBecause=" + JSON.stringify(w.refusedBecause));
console.log("omission             : linkOmittedBecause=" + JSON.stringify(w.linkOmittedBecause));
console.log("accepted-not-observed: observation.status=" + w.observation.status + " (polls " + w.observation.polls + ", bound " + w.observation.timeoutMs + "ms)");
console.log("bothStatesRead       :", w.bothStatesRead);
'

step "14. reset — remove only what this tool owns, verify absent"
node "$REPO/scripts/reset-writeback.mjs" "$URN" \
  --out "$HERE/proof-reset.json" 2>&1 | tail -11
echo "reset exit: $?"

step "15. reset again — already-clean is distinct from cleared"
node "$REPO/scripts/reset-writeback.mjs" "$URN" 2>&1 | tail -5

step "DONE"
