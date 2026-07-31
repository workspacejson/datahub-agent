# Audit report — HAC-250: Causal plan-difference audit

> **Branch:** `audit/hac-250-causal-plan-diff`
> **Base commit:** `1563e74` (main)
> **Worktree:** `/Users/user1/Documents/hackathons/audit-wt-07`
> **Date:** 2026-07-30
> **Auditor:** Cascade (automated)

## Summary

The frozen HAC-152 carrier artifact (`live-qwen-judge-run-bundle.json`) is structurally valid, digest-bound to its event, and carries three typed deltas with traceable evidence. The DataHub-only plan explicitly refuses to act on unknown source location; the joined plan resolves it exactly. Each delta is causally attributable to the joined context. No paraphrases, unsupported deductions, or omitted uncertainty were found.

## 1. Frozen artifact inspection

### 1.1 Artifact identity

| Field | Value |
|-------|-------|
| File | `evaluation/hac-152/live-qwen-judge-run-bundle.json` |
| SHA-256 | `7498f885e981d6d780ad7abef0c93ddd5dc0bd76eea16db9fb694017cf2ecb1a` |
| Bundle version | `1.0` |
| Comparison version | `1.0` |
| Event version | `1.3` |

### 1.2 SHA-256 checksum verification

All three committed JSON artifacts match their recorded checksums in `SHA256SUMS`:

- `live-mcp-event.json`: `3e3b236f...` — verified by `hac-152-live-package.test.ts`
- `live-event-with-writeback.json`: `1a863433...` — verified by `hac-152-live-package.test.ts`
- `live-qwen-judge-run-bundle.json`: `7498f885...` — verified by `hac-152-live-package.test.ts`

### 1.3 Bundle validation

`validateBundle()` returns `[]` (no problems). The test `hac-152-live-package.test.ts` confirms:

- `validateBundle(bundle)` equals `[]`
- `bundle.comparison.joinedPlan.run.model` is `"qwen-plus"`
- `bundle.comparison.deltas` has length 3
- `bundle.event.datahub.lineageObservation.upstreams` has `read: "ok"`, `completeness: "not-established"`, `observedCount: 8`
- `bundle.event.datahub.lineageObservation.downstreams` has `read: "ok"`, `completeness: "not-established"`, `observedCount: 1`
- `bundle.event.writeback` has `succeeded: true`, `noop: false`, `bothStatesRead: true`

## 2. Identity verification

### 2.1 Task, prompt, model, settings

Both plans carry identical `RunIdentity`:

| Field | DataHub-only plan | Joined plan | Match |
|-------|-----------------|-------------|-------|
| taskId | `add-quality-check` | `add-quality-check` | YES |
| promptDigest | `sha256:d19f4d09...` | `sha256:d19f4d09...` | YES |
| model | `qwen-plus` | `qwen-plus` | YES |
| settingsDigest | `sha256:e4ff4911...` | `sha256:e4ff4911...` | YES |

`sameRunIdentity()` confirms: the two plans were produced under the same setup. Any delta between them is attributable to the context difference, not a confound.

### 2.2 Repository revision

| Field | Event | Comparison snapshot | Match |
|-------|-------|---------------------|-------|
| repository | `https://github.com/dcaribou/transfermarkt-datasets` | same | YES |
| commit | `59fa295c51fc23466f3a71542f8bf3d1335daa83` | same | YES |

### 2.3 DataHub snapshot

| Field | Event | Comparison snapshot | Match |
|-------|-------|---------------------|-------|
| gmsUrl | `http://localhost:8080` | same | YES |
| eventProducedAt | `2026-07-29T01:48:36.086Z` | same | YES |

### 2.4 Event digest binding

The comparison carries `eventDigest: "75a8ec70be7b422546fa324a88a8c0a5574fa27d738ef9a99e3b0d4f380ab501"`. `digestEvent()` computes the digest over the 9 enumerated fields (`eventVersion`, `provenance`, `subject`, `datahub`, `code`, `partners`, `evidence`, `accounting`, `unavailable`), excluding the writeback receipt. The bundle validation confirms the digest matches.

## 3. Delta analysis

### 3.1 Delta 1: `added` — "use exact source dbt/models/curated/game_events.sql"

- **Kind:** `added`
- **Label:** "use exact source dbt/models/curated/game_events.sql"
- **Reason:** "Only the joined context contains the corpus-matched repository-relative producing file."
- **Evidence refs:** `evidence.records[0]`
- **Causal trace:** The event's `unavailable[1]` records that `code.repositoryRelativePath` is `not-exposed-by-source` from DataHub. The joined context's `evidence.records[0]` records that the workspace.json artifact matched repository, revision, and repository-relative source path exactly. The DataHub-only plan's step `refuse-unknown-source` confirms it could not use this information. The joined plan's step `add-dbt-quality-check-for-game-events` uses the exact path `dbt/models/curated/game_events.sql`.
- **Why DataHub-only failed:** MCP `get_entities` exposes `customProperties.dbt_file_path` (`models/curated/game_events.sql`) but not the repository-relative path with project prefix. The `unavailable` entry explicitly states this. Without the workspace.json join, the model cannot distinguish `dbt/models/curated/game_events.sql` from any other `models/curated/game_events.sql` in a different repo.
- **Paraphrase check:** The label names the exact file path. The reason states the causal mechanism. No paraphrasing detected.
- **Unsupported deductions:** None. The evidence record directly supports the claim.
- **Omitted uncertainty:** None. The evidence tier is `VERIFIED` with `checkExecuted: true`.

### 3.2 Delta 2: `removed` — "refuse unknown source location"

- **Kind:** `removed`
- **Label:** "refuse unknown source location"
- **Reason:** "The DataHub-only projection records that repository-relative source location is not exposed; joined evidence resolves it exactly."
- **Evidence refs:** `unavailable["code.repositoryRelativePath"]`, `evidence.records[0]`
- **Causal trace:** The DataHub-only plan's only step is `refuse-unknown-source` with action "refuse to add the dbt quality check because the repository-relative source location is unknown and cannot be guessed". The joined plan replaces this refusal with a concrete action. The `unavailable` entry for `code.repositoryRelativePath` with `reason: "not-exposed-by-source"` is the direct evidence for why the DataHub-only plan refused.
- **Why DataHub-only failed:** The MCP projection drops repository, revision, and project prefix. The plan correctly refused to guess rather than fabricating a path — this is the intended behavior, not a bug. The delta records that the refusal is *removed* when joined context is available.
- **Paraphrase check:** The label and reason are precise. The reason names both sides: what DataHub lacks and what joined evidence provides.
- **Unsupported deductions:** None. Both evidence refs resolve to entries in the bundled event.
- **Omitted uncertainty:** None. The `unavailable` entry carries `reason: "not-exposed-by-source"`, which is a positive claim about what the source does not expose, not a gap in observation.

### 3.3 Delta 3: `constrained` — "constrain work to dbt/models/curated/game_events.sql at 59fa295c..."

- **Kind:** `constrained`
- **Label:** "constrain work to dbt/models/curated/game_events.sql at 59fa295c51fc23466f3a71542f8bf3d1335daa83"
- **Reason:** "The exact corpus revision and producing file constrain the joined plan to one checkable source location."
- **Evidence refs:** `evidence.records[0]`
- **Causal trace:** The joined plan's step action includes "using repository-relative source \"dbt/models/curated/game_events.sql\" and pinned revision \"59fa295c51fc23466f3a71542f8bf3d1335daa83\"". The evidence record confirms the artifact matched repository, revision, and path exactly. The constraint is that the plan is bound to one specific file at one specific commit — it cannot drift to a branch-relative URL or a different file.
- **Why DataHub-only failed:** Without the workspace.json join, there is no commit pin. A branch-relative URL would drift, which is why `linkOmittedBecause` in the writeback receipt states "no commit-pinned source URL is available; an unpinned link would drift from the artifact it describes".
- **Paraphrase check:** The label includes the exact path and full commit hash. No paraphrasing.
- **Unsupported deductions:** None. The constraint follows directly from the evidence record.
- **Omitted uncertainty:** None. The `workspaceArtifact.integrity` is `"exact-match"`, which is a positive verification, not an assumption.

## 4. Evidence reference resolution

All evidence references in all three deltas were verified against `evidenceRefsOf(event)`:

| Delta | Evidence ref | Resolves to |
|-------|-------------|-------------|
| Delta 1 | `evidence.records[0]` | `evidence.records[0]` in event |
| Delta 2 | `unavailable["code.repositoryRelativePath"]` | `unavailable[1]` (field-indexed) |
| Delta 2 | `evidence.records[0]` | `evidence.records[0]` in event |
| Delta 3 | `evidence.records[0]` | `evidence.records[0]` in event |

No delta cites evidence the event does not contain. No delta has an empty evidence refs array.

## 5. Placeholder detection

`looksLikePlaceholder()` was applied to all delta labels, reasons, and plan step actions:

- Delta labels: None match placeholder patterns
- Delta reasons: None match placeholder patterns
- DataHub-only plan step action: "refuse to add the dbt quality check because the repository-relative source location is unknown and cannot be guessed" — not placeholder
- Joined plan step action: "Add a dbt quality check for game_events, preserving the declared lineage and recording the DataHub enrichment outcome, using repository-relative source \"dbt/models/curated/game_events.sql\" and pinned revision \"59fa295c51fc23466f3a71542f8bf3d1335daa83\"" — not placeholder

## 6. Completeness and uncertainty

### 6.1 Lineage completeness

Both upstream and downstream lineage observations carry `completeness: "not-established"`. The event explicitly records that an observed count (8 upstream, 1 downstream) is not an exhaustiveness claim. This uncertainty is visible in the bundle and is not promoted to a stronger claim anywhere in the comparison.

### 6.2 GMS version

`provenance.datahub.gmsVersion` is `null` with `reason: "not-exposed-by-source"`. The MCP server exposes no tool reporting the GMS version. This is recorded as an unavailable field, not hidden or defaulted.

### 6.3 Partners

`partners` is an empty array with an `unavailable` entry stating `reason: "indeterminate"` and `completeness: "not-established"`. No partners are asserted. The comparison does not cite partner evidence.

### 6.4 Writeback link omission

The writeback proceeded without a source link (`linkOmittedBecause` is non-null). The comparison's delta 3 constrains to a specific file and revision, but the writeback could not write a link because `code.sourceUrl` is `null` (MCP drops `externalUrl`). This is a stated omission, not a hidden gap.

## 7. Live re-run status

Re-running the paired comparison requires:
1. A running DataHub OSS instance with the transfermarkt corpus ingested
2. The `mcp-server-datahub` binary on PATH
3. An OpenAI-compatible Qwen endpoint (`HAC152_QWEN_CONFIG`)

The reproduction script `scripts/reproduce-hac-152-live.sh` automates this. It was not executed in this audit worktree because it requires a live DataHub instance and external model API access. The committed artifact serves as frozen evidence of a successful live run, and its integrity is verified by the test suite.

**Recommendation:** Execute `reproduce-hac-152-live.sh` against a live DataHub instance to confirm the deltas reproduce. The frozen artifact's structure, validation, and causal trace are sound.

## 8. Causal verdict

**PASS** — The three typed deltas are causally attributable to the joined workspace.json context:

1. **added** — The exact source path is only available through the corpus-matched workspace artifact. Evidence-backed, no paraphrase.
2. **removed** — The DataHub-only plan's refusal is directly caused by the MCP projection's lack of repository-relative path. Evidence-backed by the `unavailable` entry.
3. **constrained** — The commit pin constrains the plan to one checkable location. Evidence-backed by the exact-match integrity record.

No unsupported deductions, no paraphrases, no omitted uncertainty. The bundle is valid, digest-bound, and carries traceable evidence for every claim.
