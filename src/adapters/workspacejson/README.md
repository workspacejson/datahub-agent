# workspace.json DataHub/dbt adapter

Internal module. Joins dbt models to [workspace.json](https://www.workspacejson.dev)
behavioral intelligence (fragility, co-change, modification history) by
**repository-root-relative POSIX path**.

Adopted from `workspacejson/cli@c60447fc` under
[META-248](https://linear.app/marcelle-labs/issue/META-248). See
[`docs/provenance.md`](../../../docs/provenance.md) for the baseline commit,
per-file source identity, and the parity result.

> This is **not** a package and has no `package.json`, no `bin`, and no
> published identity. It is internal to this application by design — promotion
> to a package happens only on observed reuse by a second DataHub application.

## The problem it solves

dbt's `manifest.json` reports `original_file_path` relative to the **dbt project
root**. A workspace.json `fileIndex` is keyed relative to the **git repository
root** (see `@workspacejson/spec`, VR-640). When the dbt project is nested in a
subdirectory — `dbt/` under the repo root, the common real-world layout — the two
path representations differ by exactly that prefix, and a naive join silently
returns **zero rows** (no error). This was reproduced empirically in the HAC-75
probe: 5/5 match at the repo root, 5/5 miss when nested.

## The fix (the normalization shim)

```
projectPrefix = relative(gitRoot, dbtProjectDir)   // "dbt" when nested, "" at root
joinKey        = projectPrefix ? `${projectPrefix}/${original_file_path}` : original_file_path
```

`dbtProjectDir` is wherever `dbt_project.yml` lives. Real repos hold more than one
dbt project, so `findDbtProjects()` enumerates **all** of them rather than
assuming a single knowable path.

## The full seam

```text
dbt manifest node
   -> original_file_path       nodes.ts      (added here; HAC-162)
   -> repo-root-relative key   normalize.ts  (adopted)
   -> workspace.json evidence  join.ts       (adopted)
```

`nodes.ts` was added at adoption. The adopted module covered
`dbt → fileIndex` but had no non-silent node extraction.

## Two extraction paths — pick deliberately

| Function | Behavior | Use when |
| -- | -- | -- |
| `extractModels` (`dbt.ts`) | models only; **silently** drops every other node type and any null `original_file_path` | never in new code — it exists to hold the parity baseline |
| `extractDatasetNodes` (`nodes.ts`) | models, seeds and snapshots; accounts for **every** node as kept, dropped, or excluded | always |

`extractModels` discards 23 of the 28 nodes in the frozen proof corpus without
a word. [HAC-162](https://linear.app/marcelle-labs/issue/HAC-162) requires that
a dropped node warn rather than vanish, so `extractDatasetNodes` is the path the
join uses. `extractModels` is left byte-identical because the parity harness
pins it.

## Usage

```bash
tsx src/adapters/workspacejson/cli.ts \
  --git-root . \
  --manifest dbt/target/manifest.json \
  --workspace-json .agents/workspace.json
```

Exit codes:

| Code | Meaning |
| -- | -- |
| `0` | at least one model joined |
| `1` | zero models joined out of a non-empty set — the silent failure HAC-75 exists to surface |
| `2` | the dbt project is not inside the git root, so no repo-root-relative key is derivable |

## Dependencies

Consumes `@workspacejson/spec` at the published version `0.4.4` (registry, not a
workspace link) for the `FileIndexEntry` key contract.

## Status

The path-normalization shim and join are adopted with parity preserved at 35/35.
Non-silent extraction is new and tested against the frozen
proof corpus ([HAC-143](https://linear.app/marcelle-labs/issue/HAC-143)).
