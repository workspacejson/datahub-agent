# Feedback evidence log

Running record for [HAC-215](https://linear.app/marcelle-labs/issue/HAC-215).
Captured **as it happens**, not reconstructed during submission week — a
reconstructed log loses the exact error strings and the real time cost, which
are the only parts worth anything to the DataHub team.

Entries are append-only and dated. Each records what was attempted, what
happened verbatim, and what it cost.

---

## 2026-07-26 — Session 1: adapter adoption, corpus freeze, node-type coverage

Scope: META-248, HAC-143, HAC-162.

### What worked

**DataHub's local quickstart path is well documented.** `datahub docker
quickstart` is a single documented command with a clean teardown
(`datahub docker nuke`). Not exercised end-to-end this session — no DataHub
instance was required, since the URN seam was verified against dbt manifests
directly — but the documentation was unambiguous on first read.

**dbt manifest field stability was better than assumed.** `original_file_path`
is populated for every node type tested at dbt 1.12.0, including the ones we
expected to be risky. See `evaluation/dbt-node-coverage.md`.

### Where setup or documentation caused delay

**dbt-labs/jaffle_shop_duckdb's default branch is `duckdb`, not `main`.**
Cost: one failed API call and a re-probe.

```
$ gh api /repos/dbt-labs/jaffle_shop_duckdb/commits/main
{"message":"No commit found for SHA: main", ... "status":"422"}
```

Not a DataHub issue — recorded because the corpus is a DataHub-adjacent
reference repo that other hackathon entrants will likely also pin, and the
non-obvious default branch is a real papercut for anyone scripting against it.

**The corpus ships no `target/`, so `manifest.json` must be built before any
join can be attempted.** Reasonable, but it means "point the tool at a dbt
repo" is never a one-step operation. Full sequence needed:
`dbt seed && dbt run && dbt docs generate`. `dbt parse` alone is enough for the
manifest if you do not need the catalog — worth knowing, and not obvious.

### Bugs and exact error messages

**1. dbt sources: our own tracking issue's stated method was wrong, and the
manifest is the correction.** HAC-162 asserted sources "use a different path
field". At dbt 1.12.0 sources use the **same** `original_file_path` field,
under `.sources` rather than `.nodes`. Corrected in
`evaluation/dbt-node-coverage.md`. No DataHub or dbt defect — an incorrect
assumption on our side, recorded because it was load-bearing for the join.

**2. Adopted adapter fails to compile against real `@types/node`.** The
upstream package typechecked only because its tsconfig pulled in an ambient
`types/ambient.d.ts` that **shadows `node:fs`** with a hand-written `Dirent`.
Against `@types/node@22.19.17`:

```
src/adapters/workspacejson/dbt.ts(42,7): error TS2322: Type 'Dirent<string>[]' is not assignable to type 'Dirent<NonSharedBuffer>[]'.
  Type 'Dirent<string>' is not assignable to type 'Dirent<NonSharedBuffer>'.
    Type 'string' is not assignable to type 'NonSharedBuffer'.
src/adapters/workspacejson/dbt.ts(47,29): error TS2367: This comparison appears to be unintentional because the types 'NonSharedBuffer' and 'string' have no overlap.
src/adapters/workspacejson/dbt.ts(49,53): error TS2345: Argument of type 'NonSharedBuffer' is not assignable to parameter of type 'string'.
src/adapters/workspacejson/dbt.ts(50,24): error TS2345: Argument of type 'NonSharedBuffer' is not assignable to parameter of type 'string'.
```

Latent defect masked by the shim, not introduced by the adoption. Fixed with a
type-only annotation change; full record in `docs/provenance.md`. **Worth
reporting upstream to `workspacejson/cli`.**

**3. Silent node dropping in the join path.** `extractModels` discards 23 of
the frozen corpus's 28 nodes, and on the node-type probe discards exactly the
snapshot and the seed, with no warning, count, or non-zero exit. Ours, not
DataHub's — but it is the precise failure mode that makes metadata joins
untrustworthy, so it is recorded as a pattern. Resolved by
`extractDatasetNodes`; see `evaluation/dbt-node-coverage.md`.

### Blocked / cannot proceed — RESOLVED 2026-07-26

**~~No real `workspace.json` producer run is possible for the proof corpus.~~**

Recorded as the largest gap between what was demonstrated and what the project
claims end-to-end. `@workspacejson/cli` returned `E404`, and
`docs/clean-room.md` forbids consuming an unpublished package from source, so
the fixture carried a synthesized file list with empty values.

**`@workspacejson/cli@0.5.0` is now published.** The fixture is a genuine
producer run, verified against the published artifact rather than a local
build:

```console
$ npm install @workspacejson/cli          # 0.5.0
$ npx workspacejson generate .
  run 1: keys=3 selfIncluded=false sha=373dc3999b12
  run 2: keys=3 selfIncluded=false sha=373dc3999b12
  run 3: keys=3 selfIncluded=false sha=373dc3999b12   # converges from run 1
```

The gap is closed, and the judge-facing path now resolves through a public
install rather than a source checkout.

### Where setup or documentation caused delay — second entry

**The published package is ESM-only in its `exports` map, which is correct but
worth knowing before you write resolution code.** `exports` declares a `.`
entry with `import` and `types` conditions and no `require` condition, so:

```
createRequire(import.meta.url).resolve('@workspacejson/cli')
  -> ERR_PACKAGE_PATH_NOT_EXPORTED: No "exports" main defined
import.meta.resolve('@workspacejson/cli')
  -> works
```

`./package.json` is likewise unexported, so the common trick of requiring a
dependency's manifest to read its version fails too — read it by path after
walking up from the resolved entry.

Cost: two failed attempts. **Not a defect** — it is correct ESM packaging, and I
checked before reporting it as one. Recorded because it is the kind of thing
that reads as a broken package when it is actually a caller using CJS resolution
against an ESM-only export map.

### On the URN → source-file chain

Before a DataHub instance was available, this chain was built by reading
`manifest.json` out of band and reconstructing `database.schema.alias` to match
a dataset URN back to a dbt node.

Measured against a live instance, that is more work than necessary: dbt
ingestion already attaches `dbt_file_path` and `dbt_unique_id` as dataset
properties, and both are projected through MCP. The remaining gap is narrower
and is recorded in the session entry below.

Worth keeping regardless of how the path is obtained: a naive join returns
**zero rows** when the dbt project is nested under the repository root, with no
error — reproduced 5/5 at root, 0/5 nested. A silent zero is the worst failure
shape for a metadata join, and any consumer resolving datasets to files needs to
handle the project-relative vs repository-relative distinction explicitly.

---

## 2026-07-27 — Session 2: live DataHub, MCP read path, upstream contribution

Scope: HAC-148, HAC-156. First session with a real DataHub instance.

### What worked

**The quickstart is genuinely one command, and it works.** `datahub docker
quickstart` brought up seven services and reported success in ~4 minutes on a
clean machine. The migration job (`system-update`) exited 0 without intervention.

**dbt ingestion carries more than expected.** A single recipe pointed at
`manifest.json` produced datasets, column-level lineage, and — the part that
matters here — a **commit-pinned source URL**, because `git_info.branch` accepts
a SHA rather than only a branch name:

```yaml
git_info:
  repo: https://github.com/dbt-labs/jaffle_shop_duckdb
  branch: 36bde6cba69d962b83be1d52fc65a0dce1cb4ebb
```

**`url_subdir` handles nested dbt projects correctly.** For a project at `dbt/`,
it produced `.../blob/<sha>/dbt/models/curated/game_events.sql` — the repo-root
prefix applied exactly as needed.

### What dbt ingestion already carries

More than expected, and worth stating for anyone planning a similar integration:

* `customProperties.dbt_file_path` — populated and projected through MCP;
* `customProperties.dbt_unique_id` — likewise;
* `properties.externalUrl` — populated and commit-pinned.

### The gap

`externalUrl` is held by DataHub and **dropped by the MCP projection**. It is
requested for `CorpGroup`, `Dashboard`, `Chart`, `Assertion` and `Document` in
the same GraphQL document — `Dataset` is the omission.

Reproducible scan: `node scripts/probe-mcp-dataset-fields.mjs`

```text
DataHub holds:              externalUrl  https://github.com/.../blob/36bde6cb.../models/customers.sql
MCP projects to the agent:  (absent)
DROPPED AT THE MCP BOUNDARY: externalUrl
```

Full record: [`evaluation/mcp-field-coverage.md`](../evaluation/mcp-field-coverage.md).

Why it matters, stated precisely rather than dramatically: `dbt_file_path` is
relative to the dbt project, so an agent holding only it must also know the
repository, the commit, and the project's offset from the repository root, then
rebuild the URL. `externalUrl` is that answer, already assembled by the server
and then discarded at the boundary.

### Contributed upstream rather than worked around

One line in `entity_details.gql`, matching how `Dashboard` and `Chart` already
request the field. Regression test asserts against the GraphQL document, so it
runs without credentials; confirmed red before and green after.

Worth stating plainly: the fix makes our own path-normalization shim largely
unnecessary for DataHub consumers. We filed it anyway. A workaround only we can
operate is worth less than a fix everyone gets.

### Where setup caused delay

**Docker Desktop's "Apply & Restart" shut down without restarting** — twice —
needing a manual relaunch each time. Not a DataHub issue, but it cost two
multi-minute waits diagnosing a daemon that simply was not running.

**The documented 8 GB minimum is real.** The declared JVM initial heaps across
the quickstart's services sum to ~3 GB before container overhead, and those are
`-Xms` floors. At 5.8 GB the risk is OOM during the migration job, which would
leave a half-migrated state — worse than failing clean. At 12.7 GB the whole
stack settled at ~3.8 GB with no drama.

**Client/server version skew warning.** CLI `1.6.0.15` against GMS `v1.5.0.6`
prints an incompatibility warning and recommends downgrading. It did not affect
ingestion or reads in this session, but it is noise that a first-time user will
reasonably worry about.

### Highest-value DataHub improvement — revised

**Project `Dataset.externalUrl` through the MCP server.** Same conclusion as
before in spirit, but now correctly located: the fix belongs in the MCP
projection, not in dbt ingestion, because ingestion already does its part.

This is filed as a one-line upstream change with a live repro rather than left
as a suggestion.

---

## Devpost draft state

Tracked here so the submission fields are never reconstructed from memory.

| Field | State |
| -- | -- |
| Project title | **not yet set** — still `Untitled` |
| Tagline | not yet set |
| Description | not yet set |
| Category | **Metadata-Aware Code Generation & Development** (decided) |
| Public repository | https://github.com/workspacejson/datahub-agent |
| `examples/` link | pending — [HAC-148](https://linear.app/marcelle-labs/issue/HAC-148) / [HAC-152](https://linear.app/marcelle-labs/issue/HAC-152) |
| Runnable path | `docs/quickstart.md` (DataHub side); application entry pending HAC-148 |
| Video | not yet recorded |
| Upstream contributions | none yet; one candidate — the `types/ambient.d.ts` masking defect above |
| Submission status | `submission_pre_draft` |

### Technologies actually demonstrated

Claimed **only** where genuinely used. Anything not yet exercised is marked so
and must not appear on the submission until it is.

| Technology | Status |
| -- | -- |
| dbt (`manifest.json`, multi-node-type coverage) | **used** — corpus + probe, dbt 1.12.0 |
| DataHub dataset URN semantics | **used** — DataHub-returned URNs consumed via `src/integration/mcp-read.ts` |
| DataHub OSS/Core | **not yet** — no instance stood up |
| DataHub MCP Server | **not yet** — pending HAC-148 |
| Agent Context Kit | **not yet** — pending [HAC-163](https://linear.app/marcelle-labs/issue/HAC-163) substrate decision |
| Analytics Agent | **not yet** — pending HAC-163 |

> Corrected 2026-07-29 under HAC-273; previous `urn.ts` reference in the URN semantics row superseded after dormant seam removal.

### Pre-existing-work disclosure

To be stated plainly on the submission:

> The `workspace.json` standard, its producer CLI, and the dbt path-normalization
> adapter in `src/adapters/workspacejson/` are **pre-existing work**, developed
> before the hackathon and adopted into this repository under META-248 with full
> provenance recorded in `docs/provenance.md` (frozen baseline commit, per-file
> source identity, 35/35 parity).
>
> New work in this repository for the hackathon: non-silent dbt node
> extraction (`nodes.ts`), the end-to-end node extraction → source → evidence
> integration test, the frozen proof corpus selection and its node-type
> coverage verification, and the DataHub application itself.
>
> Corrected 2026-07-29 under HAC-273; previous `urn.ts` reference superseded after dormant seam removal.

Keeping this line honest and specific is worth more than maximizing the claimed
surface. Judges can read `docs/provenance.md`.
