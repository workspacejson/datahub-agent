# DataHub adopter integration and compatibility contract

> **Type:** Reference | **Status:** Current | **Scope:** DataHub integration surface

This document states what a DataHub maintainer needs to know to adopt, integrate
with, or build on Tally. Every statement points to executable code or a
verification command.

## Extension surfaces used

Tally interacts with DataHub through two surfaces:

1. **MCP server over stdio** (`acryldata/mcp-server-datahub`) — the read path.
   Spawned as `mcp-server-datahub --transport stdio`, pointed at GMS through
   `DATAHUB_GMS_URL`. Three MCP tools are required: `get_entities`,
   `get_lineage`, and `list_schema_fields`. The emitter refuses to start if any
   are missing.

2. **GraphQL mutations** — the writeback path. Two mutations, nothing else:
   `upsertLink` (labelled link from dataset to producing file) and
   `upsertStructuredProperties` (evidence tier).

**Source:** `src/integration/mcp-read.ts` (read), `src/integration/writeback.ts`
(write).

## Fields read through MCP

| Field | Source | Notes |
|-------|--------|-------|
| `customProperties.dbt_file_path` | `get_entities` | Populated by dbt ingestion, projected through MCP |
| `customProperties.dbt_unique_id` | `get_entities` | Same |
| Dataset name, platform, description | `get_entities` | Standard fields |
| Upstream/downstream lineage edges | `get_lineage` | `max_hops: 3` (server's documented "unlimited") |
| Schema field count | `list_schema_fields` | Counted separately because `get_entities` can truncate the field list |

**Not read:** `externalUrl`. DataHub holds it but the MCP `Dataset` projection
drops it. See [`evaluation/mcp-field-coverage.md`](../evaluation/mcp-field-coverage.md).

## Fields written

| Mutation | What it writes | Property URN |
|----------|---------------|--------------|
| `upsertLink` | Labelled link from dataset to producing file, pinned to immutable commit | Label: `"Producing source (workspace.json)"` |
| `upsertStructuredProperties` | Evidence tier | `urn:li:structuredProperty:workspacejson_evidence_tier` |

**Deliberately not written:** risk scores, descriptions, editable properties, or
anything under a `manual.*` path. The writeback test asserts this.

**Merge semantics:** `upsertStructuredProperties` merges by property URN — it
does not replace the aspect. Assignments written by other consumers survive.
`upsertLink` appends; existing links are not removed. See
[`docs/feedback-evidence.md`](feedback-evidence.md) for the resolver analysis.

**After-state observation:** The writeback polls the catalog after each
mutation to confirm the write landed. `bothStatesRead: true` means both the
pre-write and post-write states were observed.

## Credentials and permissions

| Requirement | Value |
|-------------|-------|
| DataHub GMS URL | `DATAHUB_GMS_URL` env var (default `http://localhost:8080`) |
| DataHub token | `DATAHUB_TOKEN` env var (optional for local quickstart, required for authenticated instances) |
| Telemetry | `DATAHUB_TELEMETRY_ENABLED=false` recommended — the MCP server blocks on an outbound telemetry POST |
| MCP binary | `mcp-server-datahub` on `PATH`, or override with `--mcp-command` |
| Write permissions | The token must allow `upsertLink` and `upsertStructuredProperties` on the target dataset |

No credentials are stored in committed artifacts. See
[`SECURITY.md`](../SECURITY.md).

## Degraded behavior

| Condition | Behavior |
|-----------|----------|
| MCP server missing a required tool | Emitter refuses to start — no half-measurement event |
| `externalUrl` absent from MCP | `code.sourceUrl` stays null; writeback states a scoped link omission |
| Lineage read returns empty | Recorded as `absent` (positive claim: asked, got nothing) — never as "no dependencies" |
| Lineage read may be incomplete | Recorded as `indeterminate` with returned edges preserved as evidence |
| Schema field count truncated | Counted via `list_schema_fields`, not `get_entities` |
| Writeback after-state not observed | `bothStatesRead: false` — the write is recorded but confirmation is missing |
| Repository revision mismatch | Claim withheld; event records the mismatch |

## Contract version and compatibility

The `ChangeImpactEvent` contract is at version **1.3**. All version bumps are
breaking — the version string distinguishes shapes, not a semver compatibility
promise. `SUPERSEDED_EVENT_VERSIONS` in
`src/integration/change-impact-event.ts` lists rejected versions.

| Version | What changed | Migration |
|---------|-------------|-----------|
| 1.0 | Initial | Superseded — re-emit |
| 1.1 | Added `datahub.lineageObservation` (required) | Superseded — re-emit |
| 1.2 | Added `provenance.workspaceArtifact.repository`, `.revision`, `.integrity` (required) | Superseded — re-emit |
| 1.3 | Froze vocabulary: `verified` → `checkExecuted`, `bothStatesRead`, `complete-against-pinned-manifest` / `not-established` | Current |

**No in-place upgrades.** Each breaking change requires re-emission because the
new field records an observation the old event does not carry. Synthesising a
default value would manufacture an observation nobody made.

## Adapter parity and source-mode boundary

The adapter in `src/adapters/workspacejson/` was transferred from
`workspacejson/cli` under a recorded adoption ruling. Parity is verified at
35/35 checks against the frozen migration baseline.

- **Parity check:** `npm run parity:datahub-adapter`
- **Provenance:** [`docs/provenance.md`](provenance.md)
- **Clean-room rule:** [`docs/clean-room.md`](clean-room.md) — only published
  `@workspacejson/*` packages, no source-level imports

The `--transport gms` flag reads DataHub directly via GraphQL/GMS instead of
through the MCP server. It exists for comparison, not for production use.

## Upstream contribution

One line in `entity_details.gql`, matching how `Dashboard` and `Chart` already
request `externalUrl`. Filed as an upstream PR to project `Dataset.externalUrl`
through the MCP server. See [`evaluation/mcp-field-coverage.md`](../evaluation/mcp-field-coverage.md).

## What is separate application vs upstream candidate

| Component | Owner | Status |
|-----------|-------|--------|
| dbt path-normalization adapter | This repo (transferred from `workspacejson/cli`) | Adopted, frozen |
| Node extraction (`nodes.ts`) | This repo | New work |
| ChangeImpactEvent contract | This repo | New work, v1.3 |
| Cockpit UI | This repo | New work |
| `workspace.json` standard | `workspacejson/cli` (upstream) | Consumed at published versions |
| DataHub MCP server | `acryldata/mcp-server-datahub` (upstream) | Consumed |
| `externalUrl` MCP projection fix | Upstream PR | Filed |
