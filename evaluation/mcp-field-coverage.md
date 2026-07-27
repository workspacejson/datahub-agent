# MCP field coverage — what DataHub holds vs what an agent receives

Measured 2026-07-27 against a clean local DataHub OSS quickstart, GMS `v1.5.0.6`,
with the frozen proof corpus ingested.

Reproduce:

```bash
node scripts/probe-mcp-dataset-fields.mjs
node scripts/probe-mcp-dataset-fields.mjs 'urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)'
```

## Why this was measured at all

An agent consuming the MCP server sees that a field is absent and **cannot tell
why**. Either the catalog never held it, or the projection dropped it on the way
out. Those two situations call for opposite fixes — change how you ingest, or
change the projection — so distinguishing them is the entire finding.

The probe issues two GraphQL queries against the *same* GMS and the *same* URN:
one for the fields DataHub can serve, one transcribing the MCP server's own
`entityPreview → Dataset → properties` block. Like-for-like, rather than a claim
about MCP's behavior.

## Result

```text
urn   urn:li:dataset:(urn:li:dataPlatform:dbt,jaffle_shop.main.customers,PROD)

DataHub holds:
  name           customers
  description    This table has basic information about a customer...
  externalUrl    https://github.com/dbt-labs/jaffle_shop_duckdb/blob/36bde6cb.../models/customers.sql

MCP projects to the agent:
  name           customers
  description    This table has basic information about a customer...

Reachable via customProperties (already projected):
  dbt_file_path  models/customers.sql
  dbt_unique_id  model.jaffle_shop.customers

DROPPED AT THE MCP BOUNDARY: externalUrl
```

Same result on a **nested** dbt project, where the difference is sharper:

```text
urn   urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)

  dbt_file_path  models/curated/game_events.sql                          <- project-relative
  externalUrl    .../blob/59fa295c.../dbt/models/curated/game_events.sql <- repo-relative

DROPPED AT THE MCP BOUNDARY: externalUrl
```

## What this establishes

**The catalog is not the problem.** DataHub computes a commit-pinned source URL
at ingestion time, derived from the dbt source's `git_info`. It is correct, it is
present, and for nested projects `url_subdir` has already resolved the prefix.

**The projection is where it is lost.** `externalUrl` is requested for
`CorpGroup`, `Dashboard`, `Chart`, `Assertion` and `Document` in the same
GraphQL document, and not for `Dataset`.

**The path is reachable, but not as a link.** `customProperties.dbt_file_path`
*is* projected — an earlier draft of `docs/feedback-evidence.md` wrongly claimed
dbt ingestion discarded the source path, and this probe is what disproved it.
But that value is relative to the dbt project. Turning it into a link requires an
agent to also know the repository, the commit, and the project's offset from the
repository root, and to reassemble the URL itself. `externalUrl` is that answer,
already assembled.

That last distinction is the whole argument, and it is narrower and more honest
than "DataHub loses the source path."

## Why it matters to this project specifically

The offset between those two values — `models/curated/game_events.sql` versus
`dbt/models/curated/game_events.sql` — is exactly what
`src/adapters/workspacejson/normalize.ts` exists to compute. DataHub's
`url_subdir` and our `projectPrefix` are the same idea, arrived at independently.

So the upstream fix would make our own normalization largely unnecessary for
DataHub consumers. We filed it anyway. A workaround that only we can operate is
worth less than a fix everyone gets, and the join is not where the value of this
project lives.

## Upstream

One line in `entity_details.gql`, matching how `Dashboard` and `Chart` already
request the field in the same fragment:

```diff
 fragment entityPreview on Entity {
         properties {
             name
             description
+            externalUrl
             customProperties {
```

Verified: the field flows through MCP after the change, for both the root-level
and nested corpora. Regression test asserts against the GraphQL document rather
than a live instance, so it needs no credentials — confirmed red before the
change and green after.

Tracked as [HAC-156](https://linear.app/marcelle-labs/issue/HAC-156).

## When this record goes stale

`scripts/probe-mcp-dataset-fields.mjs` **exits 1 if the gap closes** — that is,
if a future MCP release projects every field DataHub holds. That is the good
outcome, and it means this document should be updated rather than the probe
deleted. A record that cannot detect its own obsolescence quietly becomes a
false claim.

## Environment caveat

The DataHub CLI used for ingestion was `1.6.0.15` against GMS `v1.5.0.6`, and the
client warns about that skew. It did not affect this result — `externalUrl` is
populated and served correctly by GMS, and the probe reads GMS directly — but the
versions are recorded so the measurement can be reproduced exactly.
