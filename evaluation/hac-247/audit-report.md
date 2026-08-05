# Audit report — HAC-247: GraphQL ↔ MCP parity and version-drift

> **Date:** 2026-07-31
> **Audit mode:** automated adversarial review
> **DataHub:** GMS v1.6.0 at `http://localhost:8080`

## Summary

GraphQL `searchAcrossLineage` and MCP `get_lineage` return **identical URN sets** for the Transfermarkt subject in both directions. Hop semantics are reproducible. The MCP `max_hops=3` degree filter collapses degree 4 into `"3+"` but set membership is preserved.

## Live evidence

### Transport comparison

| Field | MCP transport | GMS transport |
|-------|--------------|---------------|
| Surface | `mcp:get_lineage` (max_hops=3, max_results=50) | `searchAcrossLineage` (query="*", start=0, count=50) |
| Upstream count | 8 | 8 |
| Downstream count | 1 | 1 |
| Upstream URNs | match GMS | match MCP |
| Downstream URNs | match GMS | match MCP |
| Evidence tier | VERIFIED | VERIFIED |
| Resolution | manifest-join | manifest-join |
| `code.sourceUrl` | null | null |
| `provenance.datahub.gmsVersion` | **unavailable** (MCP drops) | available |

### Hop-semantics spike

`scripts/spike-hop-semantics.mjs` against live GMS v1.6.0:

- **Upstream**: GraphQL 8 URNs, MCP 8 URNs — **SETS MATCH**
- **Downstream**: GraphQL 1 URN, MCP 1 URN — **SETS MATCH**
- **Verdict**: sets match between GraphQL and MCP surfaces; hop semantics reproducible
- **Note**: MCP `max_hops=3` maps to degree filter `["1","2","3+"]` — degree 4 collapses into `"3+"`

### Version drift

- GMS version: v1.6.0 (live) vs v1.5.0.6 (HAC-231 gate run) — URN sets unchanged
- MCP server: `mcp-server-datahub` 3.4.5
- One field difference: MCP transport drops `provenance.datahub.gmsVersion` (GMS transport exposes it)

## Verdict

**PASS** — GraphQL and MCP surfaces return reproducible lineage semantics. No drift detected between GMS v1.5.0.6 and v1.6.0. The `3+` degree collapse is documented and does not affect set membership.
