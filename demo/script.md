# Demo script

This script mirrors the demo video scene by scene. Each scene names what the
viewer sees, what to look for, and where the committed artifact lives for
verification without running anything.

---

## Scene 1 — The problem (0:00–0:30)

**What the viewer sees:** A DataHub dataset page for
`urn:li:dataset:(urn:li:dataPlatform:dbt,jaffle_shop.main.customers,PROD)`.
The page shows name, platform, schema, lineage — but no link to the source
file. The "External URL" field is blank.

**What to look for:** DataHub knows the dataset. It knows the lineage. It does
not show the repository file that produces it. An agent working from this page
cannot answer "which file do I edit?"

**Committed artifact:** This is the starting state. The gap is documented in
[`evaluation/mcp-field-coverage.md`](../evaluation/mcp-field-coverage.md) —
DataHub holds `externalUrl` but the MCP server does not project it.

---

## Scene 2 — The silent zero (0:30–1:00)

**What the viewer sees:** A terminal showing a naive join: dbt manifest
`original_file_path` matched against a `workspace.json` fileIndex, for a dbt
project nested under `dbt/`. The result: zero matches. Exit code: 0.

**What to look for:** The join returns nothing. No error, no warning. The dbt
manifest says `models/curated/game_events.sql`. The fileIndex keys on
`dbt/models/curated/game_events.sql`. They differ by exactly the `dbt/` prefix,
and the join silently misses every entry.

**Committed artifact:** The nested golden fixture,
[`test/fixtures/golden/change-impact-event.nested.json`](../test/fixtures/golden/change-impact-event.nested.json),
shows the correct resolution: `projectPrefix: "dbt"`,
`repositoryRelativePath: "dbt/models/curated/game_events.sql"`.

---

## Scene 3 — The resolution (1:00–2:00)

**What the viewer sees:** Tally's emitter running against the same nested
project. The output is a `ChangeImpactEvent` JSON. The `code` block shows:

```json
{
  "dbtUniqueId": "model.transfermarkt_datasets.game_events",
  "dbtFilePath": "models/curated/game_events.sql",
  "repositoryRelativePath": "dbt/models/curated/game_events.sql",
  "projectPrefix": "dbt",
  "method": "manifest-join",
  "sourceUrl": null
}
```

**What to look for:** The `projectPrefix` is `"dbt"`. The
`repositoryRelativePath` is `dbt/models/curated/game_events.sql` — the
fileIndex key. The `method` is `manifest-join`, not `external-url`, because
MCP does not expose `externalUrl`. `sourceUrl` is null, stated honestly.

**Committed artifact:**
[`evaluation/hac-152/live-mcp-event.json`](../evaluation/hac-152/live-mcp-event.json)
— the real MCP event for this dataset.

---

## Scene 4 — The evidence (2:00–3:00)

**What the viewer sees:** The `evidence` and `unavailable` blocks of the same
event.

```json
{
  "evidence": {
    "records": [
      {
        "claim": "producing file dbt/models/curated/game_events.sql is tracked in the corpus-matched workspace.json artifact",
        "observation": "Artifact repository, revision, and repository-relative source path matched exactly.",
        "source": "workspacejson",
        "checkExecuted": true
      }
    ],
    "tier": "VERIFIED"
  }
}
```

**What to look for:** `checkExecuted: true` — a check ran. The tier is
`VERIFIED` because all records carry an executed check. The tier is a function
of the records, not an assertion.

The `unavailable` block states what is missing and why:
- `code.sourceUrl` — `not-exposed-by-source` — MCP drops `externalUrl`.
- `partners` — `indeterminate` — no behavioral co-change evidence.

**Committed artifact:** Same event,
[`evaluation/hac-152/live-mcp-event.json`](../evaluation/hac-152/live-mcp-event.json).

---

## Scene 5 — The writeback receipt (3:00–4:00)

**What the viewer sees:** The writeback running and producing a receipt. The
`writeback` block shows:

- `before.evidenceTier: null` — the dataset had no prior tier.
- `after.evidenceTier: "VERIFIED"` — the tier was written.
- `bothStatesRead: true` — both states were observed.
- `succeeded: true` — mutations accepted and intended state observed.
- `linkOmittedBecause: "no commit-pinned source URL is available..."` — the
  link was deliberately not written, with a stated reason.

**What to look for:** The receipt distinguishes five outcomes: success, noop,
refusal, omission, and accepted-but-not-observed. This is a success with a
stated omission. `bothStatesRead` is the field that makes the write evidence
rather than assertion.

**Committed artifact:**
[`evaluation/hac-152/live-event-with-writeback.json`](../evaluation/hac-152/live-event-with-writeback.json)
and the [root-level golden fixture](../test/fixtures/golden/change-impact-event.root.json).

---

## Scene 6 — The cockpit (4:00–5:00)

**What the viewer sees:** The Tally cockpit UI, showing the three-view sequence:

1. **Impact** — the dataset, its lineage, and the resolved source file. Five
   seconds to read: which dataset, which file, which tier.
2. **Change plan** — DataHub-only versus joined context, side by side. The
   toggle shows what the join added: the exact repository-relative path and
   pinned revision.
3. **Receipts** — accounting, provenance, writeback, and limitations. Every
   number has a source; every absence has a reason.

**What to look for:** The cockpit renders a `CockpitViewModel`, not raw JSON.
Provisional data is clearly marked. The three-view sequence is the
judge-facing surface ratified in
[`docs/hac-217-demo-cut.md`](hac-217-demo-cut.md).

**Committed artifact:** The cockpit source is in
[`apps/cockpit/src/`](../apps/cockpit/src/). The architecture is documented in
[`docs/cockpit-architecture.md`](cockpit-architecture.md).

---

## Scene 7 — The plan comparison (5:00–6:00)

**What the viewer sees:** A paired Qwen plan comparison. The same model
(`qwen-plus`) ran both conditions — DataHub-only and joined — under identical
task, prompt digest, and temperature-zero settings. The output shows three
deltas: added, removed, and constrained.

**What to look for:** The `RunIdentity` block pins `taskId`, `promptDigest`,
and `model` — so the comparison is meaningful and not confounded by differing
run parameters. The joined plan used the exact repository-relative path; the
DataHub-only plan explicitly refused the unknown source location.

**Committed artifact:**
[`evaluation/hac-152/live-qwen-judge-run-bundle.json`](../evaluation/hac-152/live-qwen-judge-run-bundle.json).

---

## Scene 8 — Verification (6:00–7:00)

**What the viewer sees:** A terminal running the full verification suite:

```bash
npm test
npm run typecheck
npm run check:clean-room
npm run parity:datahub-adapter
```

All pass.

**What to look for:** The test suite validates the golden fixtures against the
frozen contract, the writeback invariants, and the project-layout coverage.
The clean-room audit verifies every dependency resolves to a published version.
The adapter parity check runs 35/35 against the frozen migration baseline.

**Verify locally:** Run the commands above from a clean clone.

---

## Reproduction

For a full end-to-end reproduction against a live DataHub instance:

```bash
HAC152_QWEN_CONFIG=prd_qwen_hackathon_26 \
  bash scripts/reproduce-hac-152-live.sh
```

The script checks out the exact public Transfermarkt revision in a temporary
directory, generates dbt metadata, ingests it into the local GMS, emits the
MCP event, observes the writeback, and calls Qwen through Doppler. It writes
new artifacts to a temporary run directory and never prints or stores a secret
value.

See [`evaluation/hac-152/README.md`](../evaluation/hac-152/README.md) for full
details.

---

## Demo production packet (local, gitignored)

The working directory for demo production — narration script, scene
definitions, voice config, generated audio, and rendered video — lives in
`demo/` at the repo root. It is gitignored and never pushed; judges see
only the final upload on Devpost / YouTube. The directory shape mirrors
the production-packet discipline: story order first, evidence-labeled
runs, captions frozen alongside audio.
