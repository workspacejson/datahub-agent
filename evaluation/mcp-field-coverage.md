# MCP field coverage — what DataHub holds vs what an agent receives

> **Type:** Evidence | **Status:** Current | **Scope:** MCP projection boundary

Measured against a clean local DataHub OSS quickstart, GMS `v1.5.0.6`, with two
dbt projects ingested.

```bash
node scripts/probe-mcp-dataset-fields.mjs
```

## Finding

DataHub computes a commit-pinned source URL for every dbt dataset at ingestion
time. **The MCP server does not project it to the agent.**

```text
DataHub holds:              externalUrl  https://github.com/dbt-labs/jaffle_shop_duckdb
                                         /blob/36bde6cb…/models/customers.sql
MCP projects to the agent:  (absent)

DROPPED AT THE MCP BOUNDARY: externalUrl
```

`externalUrl` is requested for `CorpGroup`, `Dashboard`, `Chart`, `Assertion`
and `Document` in the same GraphQL document. `Dataset` is the omission.

## Why it cannot be worked around

An agent still receives the file path through `customProperties.dbt_file_path` —
but that path is **relative to the dbt project**, and nothing else in the
projection anchors it.

Every property MCP returns for a dbt dataset whose project sits at `dbt/`:

```text
dbt_file_path      models/curated/game_events.sql
dbt_package_name   transfermarkt_datasets
dbt_unique_id      model.transfermarkt_datasets.game_events
language           sql
manifest_adapter   duckdb
manifest_schema    https://schemas.getdbt.com/dbt/manifest/v12.json
manifest_version   1.12.0
materialization    table
node_type          model
```

| Required to reach the source | Available without `externalUrl` |
| -- | -- |
| Repository | **No.** `dbt_package_name` is `transfermarkt_datasets`; the repository is `dcaribou/transfermarkt-datasets`. Not derivable from one another |
| Commit SHA | **No** |
| Project offset from repository root | **No** |

So the agent holds a relative path with nothing to resolve it against. It cannot
construct a link, and it cannot determine the repository-root-relative path
either — the ingestion source's `url_subdir` appears nowhere else in the
projection.

`externalUrl` is the only field carrying all three.

## The nested case makes the difference visible

For a dbt project at the repository root, the project-relative and
repository-relative paths coincide, and the gap looks cosmetic. It is not:

```text
dbt_file_path   models/curated/game_events.sql                          project-relative
externalUrl     …/blob/59fa295c…/dbt/models/curated/game_events.sql     repository-relative
```

The `dbt/` prefix is the whole difference, and it exists only inside
`externalUrl`.

## Scope of the impact

The operator who configured ingestion already knows the repository, the commit
and the prefix — they wrote them into the recipe. This gap does not affect them.

It affects **any agent consuming a DataHub instance it did not configure**, which
is the premise of the MCP server. For that agent the source link is unreachable
despite DataHub having already computed it.

## Upstream fix

One line, matching how `Dashboard` and `Chart` request the field in the same
fragment:

```diff
 fragment entityPreview on Entity {
         properties {
             name
             description
+            externalUrl
             customProperties {
```

Verified end to end: the field flows through MCP after the change, for both a
root-level and a nested dbt project. The regression test asserts against the
GraphQL document rather than a live instance, so it requires no credentials —
confirmed failing before the change and passing after.

Filed upstream against `acryldata/mcp-server-datahub`.

## Honest limits

- Recovering a *path* from `externalUrl` means parsing the segment after
  `/blob/<sha>/`, and that template differs between GitHub and GitLab. Usable,
  not elegant. A discrete repository/commit/subdirectory field would be cleaner
  than a URL, but the URL is what exists.
- This is a one-line projection fix, not an architectural contribution. It closes
  a real hole cheaply.

## Keeping this record honest

`scripts/probe-mcp-dataset-fields.mjs` exits non-zero when the gap closes, so a
future MCP release that projects the field will fail this record rather than
silently leave it stating something untrue. It refuses to report a result at all
when pointed at a dataset that carries no `externalUrl` to drop, so a mistyped
URN cannot be read as a fix.

## Confirmed through the server, not only against a transcription

The probe measures the gap by mirroring the MCP server's `entity_details.gql`
`entityPreview` fragment in a second GraphQL query and diffing the two. That is a
transcription, and it is only as good as whoever kept it in step with upstream —
the probe's own header says as much.

Since HAC-148 the read path speaks to the official MCP server over stdio, so the
same finding is now available first-hand. Calling `get_entities` on the pinned
jaffle_shop dataset and searching the decoded payload:

```text
raw get_entities (externalUrl present?)  -> externalUrl ABSENT
```

against a catalog that demonstrably holds it:

```text
externalUrl: https://github.com/dbt-labs/jaffle_shop_duckdb
             /blob/36bde6cba69d962b83be1d52fc65a0dce1cb4ebb/models/customers.sql
```

Both statements come from one instance in one run. The transcription and the
server agree, which is the outcome that makes the transcription trustworthy
rather than the outcome that makes it unnecessary — the probe stays, because it
runs without an MCP client and is the cheaper of the two checks.

Server observed: `datahub` MCP server `3.4.5`, advertising `search`,
`get_entities`, `get_lineage`, `get_lineage_paths_between`, `list_schema_fields`
and `get_dataset_queries`. Mutation tools are **not** advertised — the OSS server
registers them only behind `TOOLS_IS_MUTATION_ENABLED`, and none of them cover
`upsertLink` in any case. That is why the enrichment writeback uses DataHub's
GraphQL mutation API directly and says so, rather than claiming an MCP write path
that does not exist.

## Reproduction environment

DataHub CLI `1.6.0.15` against GMS `v1.5.0.6`. The client warns about that skew;
it does not affect this measurement, which reads GMS directly. Corpora:
`dbt-labs/jaffle_shop_duckdb@36bde6cb` (root-level) and
`dcaribou/transfermarkt-datasets@59fa295c` (nested at `dbt/`).
