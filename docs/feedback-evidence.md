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

**`@workspacejson/cli` is now published.** The fixture is a genuine
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

### Producer bumped 0.5.0 -> 0.5.1 — verified, not assumed

The 0.5.0 line above is left as written; it is what was measured at the time.

`0.5.1` fixes the CLI exiting **non-zero from `--help` and `--version`**:

```console
# 0.5.0
$ npx workspacejson --help     ; echo $?   -> 1
$ npx workspacejson --version  ; echo $?   -> 1

# 0.5.1
$ npx workspacejson --help     ; echo $?   -> 0
$ npx workspacejson --version  ; echo $?   -> 0
```

Worth recording as a papercut class, not just a fixed bug: `--help` is the
first thing anyone runs against an unfamiliar CLI, and a non-zero exit there
breaks shell pipelines, CI smoke checks and `set -e` scripts before the tool
has done anything. It is invisible to interactive use, which is why it survived
a release.

Before bumping the pin, the four-path conformance suite was run against the
newly published artifact, and `generate` output was diffed between versions:

```console
conformance vs 0.5.1 published artifact   28 passed, 0 failed

diff of generate output (timestamps removed):
<       "version": "0.5.0"
>       "version": "0.5.1"
```

The only difference is `generated.by.version`, which is excluded from the
material projection — so the patch is genuinely scoped to exit codes and does
not touch producer output. Pin bumped and the fixture regenerated on that
evidence rather than on the changelog.

### Highest-value DataHub improvement (running candidate)

*Candidate, not final — to be revised as DataHub surfaces are actually used.*

**dbt ingestion should preserve `original_file_path` on the dataset entity.**
The whole `URN → dbt model → source file` chain exists only because the source
file location is not directly retrievable from DataHub — it requires re-reading
`manifest.json` out of band and reconstructing `database.schema.alias` to match
back. If the dbt source attached `original_file_path` (and the dbt `unique_id`)
as a dataset property or a custom aspect, every consumer wanting to connect a
dataset to the code that produces it would get it in one hop, and the entire
normalization shim in `src/adapters/workspacejson/normalize.ts` — which exists
purely to bridge dbt-project-relative and repo-root-relative paths — would
become unnecessary for DataHub consumers.

Evidence this is a real gap and not a preference: a naive join silently returns
**zero rows** when the dbt project is nested under the repository root, with no
error. Reproduced 5/5 at root, 0/5 nested. A silent zero is the worst possible
failure shape for a metadata join, and it is a direct consequence of the file
path having to be reconstructed rather than carried.

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
| DataHub dataset URN semantics | **used** — `src/adapters/workspacejson/urn.ts` |
| DataHub OSS/Core | **not yet** — no instance stood up |
| DataHub MCP Server | **not yet** — pending HAC-148 |
| Agent Context Kit | **not yet** — pending [HAC-163](https://linear.app/marcelle-labs/issue/HAC-163) substrate decision |
| Analytics Agent | **not yet** — pending HAC-163 |

### Pre-existing-work disclosure

To be stated plainly on the submission:

> The `workspace.json` standard, its producer CLI, and the dbt path-normalization
> adapter in `src/adapters/workspacejson/` are **pre-existing work**, developed
> before the hackathon and adopted into this repository under META-248 with full
> provenance recorded in `docs/provenance.md` (frozen baseline commit, per-file
> source identity, 35/35 parity).
>
> New work in this repository for the hackathon: the DataHub dataset-URN
> resolution seam (`urn.ts`), non-silent dbt node extraction (`nodes.ts`), the
> end-to-end URN → dbt → source → evidence integration test, the frozen proof
> corpus selection and its node-type coverage verification, and the DataHub
> application itself.

Keeping this line honest and specific is worth more than maximizing the claimed
surface. Judges can read `docs/provenance.md`.
