# Manual verification commands

> **Type:** Guide | **Status:** Current | **Scope:** Commands requiring external services

These commands produce evidence that cannot be captured by `npm test` alone
because they require a running DataHub instance, network access, or a
long-running Docker stack. Each is documented here so a judge or adopter can
reproduce the evidence cited in `docs/claims.md` and `evaluation/README.md`.

## Prerequisites

- Docker with `docker compose`
- Python 3.11+
- Node 22.18+
- `datahub` CLI (`pip install datahub`)
- `mcp-server-datahub` (`pip install mcp-server-datahub`)

## 1. Clean quickstart proof

End-to-end: destroy and rebuild DataHub, ingest dbt corpus, emit event,
writeback, reset. One transcript from one run.

```bash
scripts/clean-quickstart-proof.sh
```

**Evidence produced:** `evaluation/clean-quickstart-proof.md`

**Re-verification:** Run the script against a fresh Docker DataHub. Compare
the transcript to the committed evidence.

## 2. Emit a ChangeImpactEvent

Read a dataset through the MCP server and emit a `ChangeImpactEvent` JSON.

```bash
node scripts/emit-change-impact-event.mjs '<urn>' \
  --subject-repository <url> --subject-revision <sha> \
  --workspace-artifact .agents/workspace.json
```

Override the MCP binary:

```bash
node scripts/emit-change-impact-event.mjs '<urn>' \
  --mcp-command /path/to/venv/bin/mcp-server-datahub \
  --subject-repository <url> --subject-revision <sha> \
  --workspace-artifact .agents/workspace.json
```

Direct GMS read (comparison only, not production):

```bash
node scripts/emit-change-impact-event.mjs '<urn>' --transport gms \
  --subject-repository <url> --subject-revision <sha> \
  --workspace-artifact .agents/workspace.json
```

**Evidence produced:** `test/fixtures/golden/change-impact-event.root.json`

## 3. Writeback and reset

Write the labelled link and evidence tier to DataHub, then reset.

```bash
node scripts/run-writeback.mjs event.json --dry-run   # preview
node scripts/run-writeback.mjs event.json              # write
node scripts/run-writeback-reset.mjs event.json        # reset
```

**Evidence produced:** Writeback receipt in the event JSON.

## 4. Paired plan comparison

Run both MCP and GMS reads against the same instance and compare.

```bash
node --import tsx scripts/run-paired-plan-comparison.mjs \
  --urn '<urn>' \
  --subject-repository <url> --subject-revision <sha> \
  --workspace-artifact .agents/workspace.json
```

**Evidence produced:** `evaluation/hac-152/live-event-with-writeback.json`

## 5. Parity check

Verify the adopted adapter matches the pre-migration baseline at 35/35 checks.

```bash
npm run parity:datahub-adapter
```

Set `PARITY_OLD_SIDE` to point at an existing checkout of the old side:

```bash
PARITY_OLD_SIDE=/path/to/workspacejson/cli npm run parity:datahub-adapter
```

**Evidence produced:** Console output (35/35 PASS).

## 6. Catalog baseline capture

Capture a DataHub catalog baseline for provenance.

```bash
node scripts/capture-catalog-baseline.mjs
```

**Evidence produced:** `evaluation/hac-248/catalog-baseline-*.json`

## 7. dbt node-type probe

Verify `original_file_path` coverage for node types not in the frozen corpus.

```bash
node scripts/build-nodetype-probe.mjs
```

**Evidence produced:** `evaluation/dbt-node-coverage.md`

## Re-verification before submission

Run all commands above against fresh infrastructure before handoff. The
follow-up issue (HAC-293) tracks this re-verification.
