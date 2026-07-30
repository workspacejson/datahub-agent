# Platform feedback from building against DataHub

We built an agent that joins a repository artifact (`workspace.json`) to a DataHub
catalog, derives a per-dataset evidence tier from what it can actually verify, and
writes that tier plus a commit-pinned link back to the catalog. Every finding below
came out of making that work against a real instance, not out of reading source for
its own sake. Where we did read source, it was to settle a question the API's
response could not answer.

Everything here was observed against DataHub OSS `datahub docker quickstart`, GMS
`v1.5.0.6`, ingesting two dbt corpora: `dbt-labs/jaffle_shop_duckdb` at
`36bde6cb` (regression) and `dcaribou/transfermarkt-datasets` at `59fa295c`
(the demo subject, 33 `dbt` plus 33 `duckdb` datasets). Ingestion used
`acryl-datahub` `1.6.0.15` and `1.6.0.16`. Two findings are backed by source
inspection rather than a runtime observation, and say so.

## The pattern

**DataHub's operations do not carry their own scope.**

Reads return a value without stating which tier answered, what consistency that
tier carries, or whether the answer is complete. Writes cannot express "add mine,
preserve theirs," so the client is left to infer the blast radius from prose. In
both directions the response is plausible either way, and the client cannot tell
the difference between a complete answer and a partial one, or between a scoped
write and a total one.

This is an observation about the API contract, not a verdict on the architecture.
Multiple serving tiers with different consistency guarantees is reasonable design,
and writing primary storage synchronously while indexing asynchronously is the
right tradeoff for a catalog. The critique is non-disclosure: the response does
not say which tier produced it, so a correct client and an incorrect one look
identical until the day they diverge.

It shows up three ways, and the ordering below follows severity rather than theme:
state that can be destroyed, answers that are wrong without looking wrong, and
answers that are ambiguous by construction.

---

## 1. CLI ingestion overwrites its own recipe in place

**Severity: data loss.** This is the only finding here where information becomes
unrecoverable.

The CLI keys its generated ingestion source by a hash of the pipeline, so every
`datahub ingest` of the same source type writes the same source URN and
**overwrites that source's stored recipe**. The catalog therefore records only how
the most recent run was configured.

Observed. Our demo corpus was ingested from `transfermarkt-datasets`; a later
audit workflow ingested `jaffle_shop` through the same source type. Reading the
source afterwards:

```text
listIngestionSources -> [CLI] dbt -> config.recipe
  git_info.repo   https://github.com/dbt-labs/jaffle_shop_duckdb
  git_info.branch 36bde6cba69d962b83be1d52fc65a0dce1cb4ebb
  manifest_path   /tmp/hac145-audit/jaffle/target/manifest.json
```

Expected: a record of how each ingested corpus was configured, or at minimum an
indication that a prior recipe was replaced. Observed: the transfermarkt recipe
that built 66 of the 82 datasets in the instance was simply gone, with no event,
no version, and nothing in the source's own history.

It survives one level down. Each `executionRequest` retains the recipe it ran with:

```text
dbt-2026_07_28-21_32_27-3ecyuy   SUCCESS  15,617ms  acryl-datahub 1.6.0.16
  manifest_path   /tmp/hac-152-live.5PoLx6/transfermarkt/dbt/target/manifest.json
  git_info.repo   https://github.com/dcaribou/transfermarkt-datasets
  git_info.branch 59fa295c51fc23466f3a71542f8bf3d1335daa83
```

That history is not durable either. `datahub-gc` runs `execution_request_cleanup`
with `keep_history_min_count: 10` and `keep_history_max_days: 90`. We were three
runs deep, under the floor, so the recipe was recoverable. A busier instance would
not have been.

**Why it is hard to notice.** The source still exists and still looks correct. It
describes a real recipe that really ran. Nothing indicates that it used to
describe a different one, and the datasets from the overwritten run are still
present, so the catalog looks complete while the provenance for most of it is
gone.

**Who else it affects.** Anyone running more than one dbt project through the CLI
into one instance, which we would expect to be common. The recipe is the only
artifact that says which repository and commit a set of datasets came from, so
losing it means losing the ability to reproduce or attribute the ingest. It is
worst for exactly the case DataHub is for: a shared catalog fed by several teams.

**Suggestion.** Key the generated source by something that distinguishes pipelines
(target platform plus manifest identity, or an explicit `pipeline_name`), or retain
prior recipe versions on the source rather than only in execution history that GC
is entitled to reap.

**Reproduction.** Ingest two different dbt projects through the CLI into one
instance, then read `listIngestionSources`. The first project's recipe is absent.

**Status:** observation only. Not filed upstream yet; we would value a maintainer's
read on whether the shared source URN is deliberate before we propose a change.

---

## 2. `Dataset.externalUrl` is dropped at the MCP boundary

**Severity: silent-wrong.** GMS holds the value; the agent receives a dataset with
no source link and no indication that one exists.

`externalUrl` is requested for `CorpGroup`, `Dashboard`, `Chart`, `Assertion` and
`Document` in the MCP server's `entityPreview` fragment, but not for `Dataset`.
The dbt source derives one from `git_info`, so the value is present and correct
in GMS:

```console
$ curl -s localhost:8080/api/graphql \
  -d '{"query":"{ dataset(urn:\"...jaffle_shop.main.customers,PROD\") { properties { externalUrl } } }"}'
"externalUrl": "https://github.com/dbt-labs/jaffle_shop_duckdb/blob/36bde6cba69d962b83be1d52fc65a0dce1cb4ebb/models/customers.sql"

$ # what get_entities returns
properties keys: ['customProperties', 'description', 'name']
externalUrl:     absent
```

**Why it is hard to notice.** `customProperties.dbt_file_path` *is* projected, so
a path is reachable and the response looks sufficient. It is not: the path is
relative to the dbt project, and nothing else in the projection carries the
repository, the commit, or the project's offset from the repository root. The
nested case makes the gap visible:

```text
dbt_file_path   models/curated/game_events.sql                           project-relative
externalUrl     .../blob/59fa295c.../dbt/models/curated/game_events.sql  repository-relative
```

An agent that builds a link from `dbt_file_path` produces a URL that is wrong for
any project not at the repository root, and wrong silently.

**Who else it affects.** Not whoever configured ingestion, who already knows the
repository and commit. It affects an agent consuming an instance it did not
configure, which is the usual MCP case.

**Status:** [acryldata/mcp-server-datahub#149](https://github.com/acryldata/mcp-server-datahub/pull/149),
open since 2026-07-27. One line, matching how `Dashboard` and `Chart` already
request the field, with a test that asserts against the GraphQL document so it
needs no credentials.

---

## 3. GraphQL errors arrive under HTTP 200

**Severity: silent-wrong**, and it is the finding that most directly caused us to
produce a confidently incorrect result.

This is GraphQL behaving to specification: a partial failure returns HTTP 200 with
both `data` and `errors`. We raise it because DataHub's own examples read `.data`
without inspecting `errors`, and because a partial response to a set-difference
query is indistinguishable from a correct one.

We audited all nine of our GraphQL clients for this. Eight were correct. One was
not, and it was the one producing an independence oracle: a probe deriving the
expected URN set, whose entire output is a set difference. A total failure would
have thrown loudly. A partial one would have looked like our derivation inventing
URNs the catalog lacks, which is precisely the conclusion the probe existed to
rule out. We would have read a broken instrument as evidence against the thing it
was measuring.

**Why it is hard to notice.** `response.ok` is `true`. `body.data` is present and
well-shaped. The missing entries look like a finding rather than a fault, and they
look like a finding that supports a conclusion you were already testing for.

**Who else it affects.** Any agent doing comparison or reconciliation against the
catalog, which is a natural thing to build on a metadata platform. The failure is
biased: it makes the catalog look emptier than it is, so it reads as "the catalog
is missing things," never as "the read failed."

**Suggestion.** Documentation-level, and cheap: in the GraphQL tutorials, check
`errors` before `data` in the example snippets. Right now the examples teach the
unsafe pattern.

**Status:** fixed on our side. Observation only upstream.

---

## 4. `max_hops` is a bucket selector, not a bound

**Severity: silent-wrong**, low blast radius but the response actively contradicts
the parameter name.

MCP `get_lineage` with `max_hops=3` maps to a degree filter of `["1","2","3+"]`.
The top bucket is open-ended, so degree-4 edges are returned to a caller who asked
for three hops.

Observed on `dbt:duck.dev.game_events`, upstream, comparing MCP against GraphQL
`searchAcrossLineage` with no degree filter:

```text
MCP get_lineage (max_hops=3) (8 edges):
  degree 1: 2 edges  [duckdb:2]
  degree 2: 2 edges  [dbt:2]
  degree 3: 2 edges  [dbt:2]
  degree 4: 2 edges  [duckdb:2]     <- returned, though max_hops=3
```

The two surfaces agreed on 8 URNs, which is what we were checking. They agreed
*because* `3+` is unbounded, not because three hops and four hops are the same
question.

**Why it is hard to notice.** It looks like agreement. Our own gate recorded
"SETS MATCH" and passed, and the match was real; the interpretation "MCP respects
max_hops" would have been wrong. On a deeper graph the caller silently receives an
unbounded closure and has no way to tell from the response.

**Who else it affects.** Anyone bounding a lineage walk for cost or for
correctness. An agent using `max_hops` as a safety limit does not have one.

**Suggestion.** Either document that the final bucket is inclusive of all greater
degrees, or filter the result to the requested degree. Documenting it is enough;
the current name implies a guarantee the implementation does not make.

**Status:** observation only.

---

## 5. Lineage reads do not disclose which tier answered

**Severity: ambiguity**, and this is the clearest instance of the general pattern.

Three surfaces answer questions about upstreams, with two different consistency
models, and nothing in any response says which one you got:

| Surface | Backed by | Consistency |
| --- | --- | --- |
| `searchAcrossLineage` | graph index | asynchronous, can lag an ingest |
| `Dataset.relationships` | graph index | asynchronous, same failure mode |
| `GET /openapi/v3/entity/dataset/{urn}/upstreamLineage` | primary storage | synchronous under `SYNC_PRIMARY` |

Verified live for `duck.dev.game_events`: the aspect read returned both direct
upstreams plus `fineGrainedLineages` immediately, while the graph-index surfaces
are subject to post-ingest lag.

This mattered concretely for us. We needed an independent cross-check on a lineage
derivation, and `Dataset.relationships` is not one: it shares a failure mode with
`searchAcrossLineage` because both read the graph index. The aspect read does not
share it, so it is a genuine cross-check along the index-lag dimension. Nothing in
the API told us that. We established it by reading how each surface is served.

**Why it is hard to notice.** All three return plausible lineage. A lagging index
returns fewer edges, not an error, so the difference between "this dataset has two
upstreams" and "the index has caught up with two of them so far" is invisible.

**Who else it affects.** Anyone reading lineage shortly after an ingest, and
anyone building a consistency check out of two surfaces without realising they
share a tier.

**Suggestion.** A consistency or freshness indicator on lineage responses would
resolve this: which tier served the read, and for index-backed reads, how far
behind it is. Failing that, documenting the tier per surface would let clients
choose deliberately.

**Status:** observation only. We compensated by reading the aspect endpoint and
polling for convergence.

---

## 6. Absent, empty, and not-yet-written aspects are the same response

**Severity: ambiguity.** This is finding 5's problem in its sharpest form, because
here there is no second surface to disambiguate against.

`GET /openapi/v3/entity/dataset/{urn}/upstreamLineage` for a source dataset
returned no `upstreamLineage` aspect. That single response is consistent with
three different facts:

- the dataset genuinely has no upstreams and the closure terminates here
- the aspect exists but is empty
- the aspect has not been written yet

We were checking whether a lineage closure terminated at degree 4. The absent
aspect was consistent with termination, and we deliberately declined to read it as
proof, because doing so would have put the exact inference our evidence contract
exists to forbid into the record that ratifies it. The termination claim rests on
the pinned dbt manifest instead:

```text
source.transfermarkt_datasets.transfermarkt_scraper.games
  declares depends_on: (field absent)
  its own upstream nodes: (none, nothing lies beyond it)
```

That is verifiable without asking DataHub anything, which is the point: we could
not get the answer from DataHub, so we got it somewhere else.

**Why it is hard to notice.** The safe reading and the useful reading differ, and
the useful one is the natural one. "No upstreams returned" reads as "no upstreams"
to essentially every consumer.

**Who else it affects.** Anyone computing lineage completeness or closure, and
anyone building a "this dataset has no upstream" assertion. It is the difference
between an evidence tier meaning "verified complete" and meaning "we asked and
got nothing back."

**Suggestion.** Distinguish absent from empty in the response, even minimally. An
explicit empty aspect, or a field stating that the aspect has never been written,
would let a client tell a fact from a silence.

**Status:** observation only. This is the single finding that most shaped our
product: our contract carries `ok` / `failed` / `not-queried` and `absent` as
distinct states precisely because DataHub cannot distinguish them for us.

---

## 7. The structured-property set/replace note describes the wrong API

**Severity: documentation**, with an inverted-remedy hazard that makes it worth
more attention than its category suggests.

`docs/api/tutorials/structured-properties.md`, above the **Set Structured Property
To a Dataset** examples:

> This action will set/replace all structured properties on the entity. See PATCH
> operations to add/remove a single property.

That sentence introduces four tabs and does not describe what any of them do as
written. The default tab is GraphQL, which merges.

Read from source at `v1.5.0.6`, and re-checked on `master`:

- **GraphQL `upsertStructuredProperties` merges by property URN.**
  `UpsertStructuredPropertiesResolver.java` reads the existing aspect (`:87`),
  returns each current assignment untouched unless its URN is in the input
  (`:91`), appends only new URNs (`:94`), and ingests the merged array (`:96`).
- **OpenAPI `POST .../structuredProperties` does not replace either, as the
  examples are written.** `createIfNotExists` defaults to `true`
  (`GenericEntitiesController.java:643`), which selects `ChangeType.CREATE`
  (v2 `:329`, v3 `:1074`), and `CreateIfNotExistsValidator` rejects a `CREATE`
  whose aspect already exists (`:73-81`, registered for `EntityAspectName.ALL`).
  Neither `curl` in the section passes the parameter.
- **`createIfNotExists=false` is the one path the sentence describes.** It selects
  `UPSERT` with the body as the whole aspect. The file already uses that form, in
  the Patch section.

**Why it is hard to notice, and why the harm is inverted.** The failure is not that
a reader loses data by following the page. A reader who believes "set/replace all"
applies to the GraphQL mutation writes defensive read-merge-write code on the
client: fetch existing properties, merge their own in, send the union. That code is
unnecessary, and it is the pattern that actually drops other people's assignments,
because it converts a server-side merge into a client-side one across a network
round trip. A stale read or a concurrent writer, and the properties the client
never saw are gone. The documentation manufactures the hazard it warns about.

The sentence also steers readers toward PATCH to avoid a replacement GraphQL does
not perform, which moves them off the safe surface onto the one that does replace.

**What it cost us.** We filed an internal P0 to migrate our writeback off
`upsertStructuredProperties` onto a property-scoped PATCH, on the strength of this
sentence, and planned a CI guard banning the mutation. Reading the resolver retired
the issue with no code change. Had we shipped the guard, it would have forbidden
the safe call and signposted the replacing one.

**Status:** [datahub-project/datahub#18754](https://github.com/datahub-project/datahub/pull/18754).
Evidence is source inspection, not a runtime test, and the PR says so.

---

## 8. Ingestion fails on a missing extra, long after setup succeeds

**Severity: documentation / setup.**

`pip install acryl-datahub` then `datahub docker quickstart` both succeed. The dbt
recipe then fails with:

> dbt is disabled due to a missing dependency: boto3

The message is clear. Its timing is not: it arrives when you first ingest, after
the quickstart has come up green, so the natural conclusion is that something is
wrong with the recipe rather than with the install. The fix is
`pip install 'acryl-datahub[dbt]'`.

**Suggestion.** Name the extra in the dbt ingestion quickstart, or have
`datahub docker quickstart` warn when no source extras are present.

**Status:** observation only. Documented in our own quickstart so the next reader
does not lose the time.

---

## 9. Telemetry blocks on an outbound POST and reads as a hang

**Severity: documentation / setup**, worse on a restricted network.

Both the CLI and the MCP server block on an outbound telemetry POST with retries.
On a network that drops rather than refuses the connection, this presents as a
hang with no output, not as a network error. `DATAHUB_TELEMETRY_ENABLED=false`
resolves it.

**Why it is hard to notice.** There is nothing to notice. The process is silent
while it retries, and the obvious hypothesis is that ingestion is slow.

**Suggestion.** A short timeout with a one-line notice, or a message naming the
environment variable when the first attempt fails.

**Status:** observation only.

---

## 10. Client and server version skew warns and recommends a downgrade

**Severity: documentation / noise.**

CLI `1.6.0.15` against GMS `v1.5.0.6` prints an incompatibility warning
recommending a downgrade. It did not affect ingestion or reads in any of our
sessions, including the ones that produced our committed evidence.

We raise it because the pairing is what a first-time user gets: `datahub docker
quickstart` pins the server, `pip install acryl-datahub` takes the newest client,
and the combination warns on every invocation. A user cannot tell from the message
whether their results are trustworthy.

**Suggestion.** Either pin the quickstart client to the server it starts, or
narrow the warning to the operations actually affected.

**Status:** observation only.

---

## 11. The documented 8 GB minimum is a real floor, and failing it fails badly

**Severity: documentation / setup.**

The declared JVM initial heaps across the quickstart's services sum to roughly
3 GB before container overhead, and those are `-Xms` floors rather than targets.
At 5.8 GB allocated to Docker, the risk is an OOM during the migration job, which
leaves a half-migrated state rather than failing clean. At 12.7 GB the whole stack
settled at about 3.8 GB with no trouble.

**Suggestion.** The minimum is documented; what is not documented is that
under-provisioning fails during migration rather than at startup. Saying so, and
failing fast with a check, would turn a confusing partial state into a clear
error.

**Status:** observation only.

---

## Where "page truncation" sits

We expected to be able to report a paging finding here and cannot honestly do so.
Our lineage reads used `count: 50` on `searchAcrossLineage` and `max_results: 50`
on MCP `get_lineage`, and our corpus is small enough (8 edges on the deepest
subject) that we never approached the limit. So we have no observed instance of a
result being silently truncated at a page boundary, and we are not going to assert
one from the parameter defaults.

Stated as a latent concern rather than a finding: combined with finding 4, a
caller who receives exactly `max_results` edges has no field telling them whether
more exist. If a maintainer knows this to be a real truncation rather than a
non-issue, we would rather record it correctly than leave it out.

## What we built because of this

The product is the compensating control. Because a read cannot tell us which tier
answered or whether an absence is a fact, our change-impact contract refuses to
collapse those cases: every observation carries `ok`, `failed`, or `not-queried`,
an absence is recorded with its reason and its source, and the evidence tier a
dataset earns is derived only from checks that actually executed. The writeback
emits a receipt whether or not it succeeded, polls the after-state rather than
trusting the mutation response, and states separately whether both states were
read and whether they matched intent. None of that would be necessary against an
API whose operations declared their own scope, and all of it exists because this
one does not.

## Contributions

- [datahub-project/datahub#18754](https://github.com/datahub-project/datahub/pull/18754)
  scope the structured-property set/replace note to the API it describes (finding 7)
- [acryldata/mcp-server-datahub#149](https://github.com/acryldata/mcp-server-datahub/pull/149)
  expose `Dataset.externalUrl` through `get_entities` (finding 2)

Findings 1, 3, 4, 5, 6 and 8 through 11 are observations we have not filed, either
because the right fix is not ours to choose (1, 5, 6) or because they are small
documentation changes we would rather bundle after a maintainer's reaction to the
first two.

## Reproduction

Everything above except findings 1 and 7 is reachable from the documented path in
[`docs/quickstart.md`](docs/quickstart.md) against a clean
`datahub docker quickstart`.

Finding 7 needs no instance; it is source inspection at a named tag, and the PR
carries the line numbers.

Finding 1 requires ingesting two different dbt projects through the CLI into one
instance, then reading `listIngestionSources`.

`scripts/capture-catalog-baseline.mjs` records an instance's datasets, per-run
ingestion recipes recovered from execution-request history, and GMS version, with
secret-shaped keys redacted before anything reaches a file. It is read-only: it
issues no mutation and writes nothing to the catalog. We wrote it because of
finding 1, to capture the recipe before a teardown could destroy it.
