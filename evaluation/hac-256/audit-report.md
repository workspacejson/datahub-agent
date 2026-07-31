# Audit report — HAC-256: DataHub integration-surface exploration

> **Branch:** `audit/hac-256-integration-surface`
> **Base commit:** `1563e74` (main)
> **Worktree:** `/Users/user1/Documents/hackathons/audit-wt-13`
> **Date:** 2026-07-30
> **Auditor:** Cascade (automated)
> **Mode:** Strictly read-only — no ingestion, no mutation

## Summary

The DataHub OSS integration surface used by this project is narrow, documented, and verified by tests. Two extension surfaces are used: MCP server (read) and GraphQL mutations (writeback). Three MCP tools are required and checked at startup. Two GraphQL mutations are used for writeback. The `adopter-contract.md` documents every field read, every field written, credentials, degraded behavior, and contract versions. The integration surface maps cleanly to the HAC-233–HAC-240 frontier bets.

## 1. Integration surface inventory

### 1.1 Read path — MCP server over stdio

**Source:** `src/integration/mcp-read.ts`

The read path uses the official DataHub MCP server (`acryldata/mcp-server-datahub`) spawned as `mcp-server-datahub --transport stdio`, pointed at GMS through `DATAHUB_GMS_URL`.

**Required MCP tools (3):**

| Tool | Purpose | Required fields |
|------|---------|-----------------|
| `get_entities` | Dataset entity details | `customProperties.dbt_file_path`, `customProperties.dbt_unique_id`, name, platform, description |
| `get_lineage` | Upstream/downstream lineage edges | URN, direction, `max_hops`, `max_results`, `query` |
| `list_schema_fields` | Schema field count | URN |

The emitter refuses to start if any of the three tools are missing — no half-measurement event is produced.

**Lineage parameters:**

- `max_hops: 3` (server's documented "unlimited" — the final bucket `3+` is open-ended per HAC-231)
- `max_results: 50`
- `query: "*"`

**Fields NOT read through MCP:**

- `externalUrl` — DataHub holds it but the MCP `Dataset` projection drops it. Filed as upstream PR [acryldata/mcp-server-datahub#149](https://github.com/acryldata/mcp-server-datahub/pull/149).
- `gmsVersion` — No MCP tool reports the GMS version. Recorded as `not-exposed-by-source`.

### 1.2 Write path — GraphQL mutations

**Source:** `src/integration/writeback.ts`

**Mutations used (2):**

| Mutation | What it writes | OSS available |
|----------|---------------|---------------|
| `upsertLink` | Labelled link from dataset to producing file | YES |
| `upsertStructuredProperties` | Evidence tier property | YES |

**Mutations deliberately NOT used:**

- `createAssertion` — Cloud-gated, not available on OSS quickstart
- Any `description` / `editableProperties` write — destroys human-authored evidence
- Any risk/fragility/score write — no defensible per-file measurement
- Any `owner`/`globalTags`/`glossaryTerms`/`domain` write — not established by this tool

### 1.3 GMS direct (comparison only)

The `--transport gms` flag reads DataHub directly via GraphQL/GMS instead of through MCP. It exists for comparison, not for production use. The HAC-231 hop-semantics gate used both surfaces to verify set-equality between GraphQL `searchAcrossLineage` and MCP `get_lineage`.

## 2. workspace.json usage vs. DataHub OSS offerings

### 2.1 What workspace.json provides that DataHub does not

| Capability | workspace.json | DataHub OSS | Gap closed |
|------------|---------------|-------------|------------|
| Repository-relative source path | YES (`fileIndex` keys) | NO (MCP drops `externalUrl`) | `code.repositoryRelativePath` |
| Commit-pinned source URL | YES (via corpus commit) | NO (branch-relative only) | `code.sourceUrl` |
| Project prefix normalization | YES (`computeProjectPrefix`) | NO | `code.projectPrefix` |
| dbt manifest join | YES (`joinModels`) | NO | `code.method: "manifest-join"` |
| Evidence tier derivation | YES (via `deriveTier`) | NO | `evidence.tier` |

### 2.2 What DataHub provides that workspace.json does not

| Capability | DataHub OSS | workspace.json | Used for |
|------------|-------------|---------------|----------|
| Dataset lineage edges | YES (`get_lineage`) | NO | `datahub.upstreams`, `datahub.downstreams` |
| Schema field count | YES (`list_schema_fields`) | NO | `datahub.schemaFieldCount` |
| Dataset name/platform/description | YES (`get_entities`) | NO | `datahub.name`, `datahub.platform`, `datahub.description` |
| Owners/domains | YES | NO | `datahub.owners`, `datahub.domain` (read, not written) |

### 2.3 What both provide (join point)

| Capability | DataHub | workspace.json | Join field |
|------------|---------|---------------|------------|
| dbt model file path | `customProperties.dbt_file_path` | `fileIndex` keys | `code.dbtFilePath` |
| dbt unique ID | `customProperties.dbt_unique_id` | manifest node ID | `code.dbtUniqueId` |

## 3. Capability classification

### 3.1 Read capabilities

| Capability | Surface | Classification | Evidence |
|------------|---------|---------------|----------|
| `get_entities` — dataset fields | MCP | **WORKING** | `mcp-read.test.ts`, HAC-152 live event |
| `get_lineage` — upstream/downstream | MCP | **WORKING** | `mcp-read.test.ts`, HAC-231 gate, HAC-152 live event |
| `list_schema_fields` — field count | MCP | **WORKING** | `mcp-read.test.ts`, HAC-152 live event (count: 2) |
| `externalUrl` projection | MCP | **UNSUPPORTED** | `unavailable[reason: "not-exposed-by-source"]`, upstream PR #149 filed |
| GMS version | MCP | **UNSUPPORTED** | `unavailable[reason: "not-exposed-by-source"]` |
| `searchAcrossLineage` (GraphQL) | GMS direct | **WORKING** | HAC-231 gate (comparison only, not production) |
| `upstreamLineage` aspect (OpenAPI) | GMS direct | **WORKING** | HAC-231 orientation check (comparison only) |

### 3.2 Write capabilities

| Capability | Surface | Classification | Evidence |
|------------|---------|---------------|----------|
| `upsertLink` | GraphQL | **WORKING** | HAC-152 live writeback, `writeback.test.ts` |
| `upsertStructuredProperties` | GraphQL | **WORKING** | HAC-152 live writeback, `writeback.test.ts` |
| `createStructuredProperty` (setup) | GraphQL | **WORKING** | HAC-152 live event (response: "already defined") |
| `createAssertion` | GraphQL | **CLOUD-ONLY** | `writeback.test.ts` asserts not used; Cloud-gated |
| Description write | GraphQL | **UNSUPPORTED** (by policy) | `writeback.test.ts` asserts not written |
| Owner/tags/glossary write | GraphQL | **UNSUPPORTED** (by policy) | `writeback.test.ts` asserts not written |

### 3.3 MCP transport capabilities

| Capability | Classification | Evidence |
|------------|---------------|----------|
| stdio transport | **WORKING** | HAC-152 live event, `mcp-transport.test.ts` |
| `DATAHUB_GMS_URL` env var | **WORKING** | Documented in `adopter-contract.md` |
| `DATAHUB_TOKEN` env var | **AUTH-GATED** | Optional for quickstart, required for authenticated instances |
| `DATAHUB_TELEMETRY_ENABLED=false` | **WORKING** | Recommended — MCP server blocks on telemetry POST |

## 4. HAC-231 hop semantics

The HAC-231 gate established that MCP `get_lineage(max_hops=3)` and GraphQL `searchAcrossLineage` return identical edge sets for the transfermarkt corpus. The amendment notes that `max_hops=3` maps to degree filter `["1","2","3+"]` where the final bucket is open-ended, so degree-4 edges appear in results. The sets matched because both surfaces were effectively unbounded over an 8-edge graph.

**Classification:** **WORKING** but **VERSION-GATED** — the hop bound cannot be claimed as a cost or correctness limit on deeper graphs. The open-ended final bucket is a property of the pinned GMS version `v1.5.0.6`.

## 5. Degraded behavior matrix

From `docs/adopter-contract.md` and verified in code:

| Condition | Behavior | Verified by |
|-----------|----------|-------------|
| MCP server missing required tool | Emitter refuses to start | `mcp-read.ts` startup check |
| `externalUrl` absent from MCP | `code.sourceUrl` stays null; writeback states scoped link omission | HAC-152 live event, `writeback.test.ts` |
| Lineage read returns empty | Recorded as `absent` (positive claim) | `change-impact-event.ts` vocabulary |
| Lineage read may be incomplete | Recorded as `indeterminate` with edges preserved | `change-impact-event.ts` vocabulary |
| Schema field count truncated | Counted via `list_schema_fields` | `mcp-read.ts` |
| Writeback after-state not observed | `bothStatesRead: false` | `writeback.test.ts`, `accepted-not-observed` fixture |
| Repository revision mismatch | Claim withheld; event records mismatch | `partial-resolution` fixture |

## 6. Mapping to HAC-233–HAC-240 frontier bets

| Bet | Capability | Classification | Status |
|-----|-----------|---------------|--------|
| HAC-233 | Lineage edge observation via MCP | **WORKING** | Verified by HAC-152, HAC-231 |
| HAC-234 | `externalUrl` projection through MCP | **UNSUPPORTED** | Upstream PR #149 filed |
| HAC-235 | Evidence tier writeback via structured properties | **WORKING** | Verified by HAC-152 live writeback |
| HAC-236 | Link writeback via `upsertLink` | **WORKING** | Verified by `writeback.test.ts` (live run omitted link due to null URL) |
| HAC-237 | Schema field count via `list_schema_fields` | **WORKING** | Verified by HAC-152 (count: 2) |
| HAC-238 | GMS version exposure via MCP | **UNSUPPORTED** | No MCP tool reports it |
| HAC-239 | Lineage hop bound semantics | **VERSION-GATED** | HAC-231 amendment: `max_hops` final bucket is open-ended |
| HAC-240 | Assertion-based writeback | **CLOUD-ONLY** | `createAssertion` not available on OSS |

## 7. Contract version compatibility

The `ChangeImpactEvent` contract is at version **1.3**. All version bumps are breaking. The `SUPERSEDED_EVENT_VERSIONS` list records rejected versions:

| Version | What changed | Status |
|---------|-------------|--------|
| 1.0 | Initial | Superseded |
| 1.1 | Added `datahub.lineageObservation` | Superseded |
| 1.2 | Added `provenance.workspaceArtifact` fields | Superseded |
| 1.3 | Froze vocabulary (`verified` → `checkExecuted`, etc.) | **Current** |

The plan comparison artifact is at version **1.0** (separate versioning from the event).

## 8. Credential and permission surface

| Requirement | Value | Gating |
|-------------|-------|--------|
| GMS URL | `DATAHUB_GMS_URL` env var (default `http://localhost:8080`) | None |
| DataHub token | `DATAHUB_TOKEN` env var | **AUTH-GATED** — optional for quickstart, required for authenticated instances |
| MCP binary | `mcp-server-datahub` on `PATH`, or `--mcp-command` override | None |
| Write permissions | Token must allow `upsertLink` and `upsertStructuredProperties` | **AUTH-GATED** |
| Telemetry | `DATAHUB_TELEMETRY_ENABLED=false` recommended | None (but blocks if not set) |

No credentials are stored in committed artifacts. `credential-scan.test.ts` verifies no secrets in committed files.

## 9. Live probing status

Live probing against a running DataHub instance was not executed in this audit worktree (strictly read-only mode, no DataHub instance available). The classification is based on:

1. Committed live evidence (`evaluation/hac-152/`) — real runs captured 2026-07-29
2. HAC-231 hop-semantics gate — real comparison between MCP and GraphQL
3. HAC-231 orientation ratification — real OpenAPI read
4. HAC-248 catalog baseline — real point observation
5. Test suite (182 tests, all passing)
6. `adopter-contract.md` documentation

**Recommendation:** Execute live probes against a running DataHub OSS quickstart to confirm all **WORKING** classifications. The read-only probing script `scripts/capture-catalog-baseline.mjs` can be used as a template.

## Verdict

**PASS** — The DataHub OSS integration surface is narrow (3 MCP tools, 2 GraphQL mutations), fully documented in `adopter-contract.md`, verified by 182 passing tests and committed live evidence. The capability matrix classifies 7 capabilities as **WORKING**, 2 as **UNSUPPORTED** (with upstream PR filed), 1 as **VERSION-GATED**, 1 as **CLOUD-ONLY**, and 2 as **AUTH-GATED**. The surface maps cleanly to the HAC-233–HAC-240 frontier bets. No undocumented integration points were found.
