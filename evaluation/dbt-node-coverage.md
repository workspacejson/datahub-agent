# `original_file_path` coverage by dbt node type

Verification for [HAC-162](https://linear.app/marcelle-labs/issue/HAC-162), the
join-key foundation under [HAC-147](https://linear.app/marcelle-labs/issue/HAC-147).

**Verdict: CLEAN — with the coverage split across two sources, and one
correction to the issue's stated method.**

Every node type the join relies on exposes a populated `original_file_path`.
Zero nulls were observed anywhere. But the frozen proof corpus contains only
three of the five node types in question, so snapshots, Python models, and
sources were verified against a purpose-built probe rather than declared
verified by extrapolation — which HAC-162 explicitly prohibits.

| Node type | Count | Populated | Null | Verified against |
| -- | --: | --: | --: | -- |
| `model` (SQL) | 5 | 5 | **0** | proof corpus |
| `seed` | 3 | 3 | **0** | proof corpus |
| `test` | 20 | 20 | **0** | proof corpus |
| `model` (Python) | 1 | 1 | **0** | probe |
| `snapshot` | 1 | 1 | **0** | probe |
| `source` | 1 | 1 | **0** | probe |

Environment: dbt-core **1.12.0**, dbt-duckdb **1.10.1**, Python 3.12.12.

## Source A — the frozen proof corpus

`dbt-labs/jaffle_shop_duckdb@36bde6cba69d962b83be1d52fc65a0dce1cb4ebb`
([HAC-143](https://linear.app/marcelle-labs/issue/HAC-143)), after
`dbt seed && dbt run && dbt docs generate`.

HAC-162's first command, verbatim:

```console
$ jq -r '.nodes | to_entries[] | "\(.value.resource_type)\t\(.value.original_file_path // "NULL")"' target/manifest.json \
    | sort | uniq -c | sort -rn
  20 test	POPULATED
   5 model	POPULATED
   3 seed	POPULATED
```

HAC-162's second command, verbatim — the explicit null check:

```console
$ jq -r '.nodes[] | select(.original_file_path == null) | .resource_type' target/manifest.json | sort | uniq -c
(no output — zero nulls in .nodes)
```

Node types present, and those absent:

```console
$ jq -r '[.nodes[].resource_type] | unique | .[]' target/manifest.json
model
seed
test

$ jq -r '.nodes[] | select(.resource_type=="model") | .language' target/manifest.json | sort | uniq -c
   5 sql

$ jq -r '.sources | length' target/manifest.json
0
```

**snapshot: 0. Python model: 0. source: 0.** Not "null" — *absent*. This corpus
cannot discharge those three, and HAC-162's DO-NOT is explicit: *"Do not assume
SQL-model behavior generalizes to seeds/snapshots/Python models."*

## Source B — the node-type probe

A minimal dbt project built solely to instantiate the three node types the
corpus lacks. It is not a second proof corpus and makes no measurement claims;
it answers exactly one question: *does dbt populate `original_file_path` for
these node kinds?*

```text
nodetype-probe/
  models/sql_model.sql      SQL model
  models/py_model.py        Python model
  models/sources.yml        source declaration
  seeds/raw_thing.csv       seed
  snapshots/snap_thing.sql  snapshot
```

```console
$ jq -r '.nodes | to_entries[] | "\(.value.resource_type)\t\(.value.language // "-")\t\(.value.original_file_path // "NULL")"' target/manifest.json | sort
model	python	models/py_model.py
model	sql	models/sql_model.sql
seed	-	seeds/raw_thing.csv
snapshot	sql	snapshots/snap_thing.sql

$ jq -r '.sources | to_entries[] | "\(.value.resource_type)\t\(.value.original_file_path // "NULL")"' target/manifest.json
source	models/sources.yml

$ jq -r '.nodes[] | select(.original_file_path == null) | .resource_type' target/manifest.json | sort | uniq -c
(no output — zero nulls)
```

Reproduce with `scripts/build-nodetype-probe.mjs`.

## Correction to HAC-162's stated method

HAC-162 says of sources: *"sources live under `.sources`, not `.nodes`, and use
a different path field — verify separately."*

The first half is right; **the second half is not**, at dbt 1.12.0. Sources live
under `.sources` and use **the same `original_file_path` field**. No separate
field is needed.

There is a real semantic subtlety underneath, though, and it matters more than
the field name:

> A source's `original_file_path` points at the **YAML that declares it**
> (`models/sources.yml`), not at a model file. Joining a source URN to "its
> file" yields the declaration site. That is a legitimate answer, but it is a
> different kind of answer than a model's — the evidence attaches to a schema
> file that many sources share, so per-source fragility is not separable.

Recorded so the join's completeness claim is not overstated for sources.

## Consequence for the join — the null is not the only silent drop

HAC-162 was written to stop a null `original_file_path` silently dropping nodes.
Verification found **zero nulls**, but found the silent-drop failure mode
present anyway, for a different reason.

The adopted `extractModels` (`src/adapters/workspacejson/dbt.ts`) filters:

```ts
if (node.resource_type === "model" && node.original_file_path) {
```

Both conditions drop silently — no warning, no count, no exit code. Measured:

```text
[proof corpus]  .nodes = 28  {model: 5, seed: 3, test: 20}
                extractModels() returned 5
                SILENTLY DROPPED     23

[probe]         .nodes = 4   {model: 2, snapshot: 1, seed: 1}
                extractModels() returned 2
                SILENTLY DROPPED     2      <- the snapshot and the seed
```

On the probe it discards precisely the node types HAC-162 exists to protect.

**Resolution.** `extractModels` is left byte-identical — it is the behavior the
META-248 parity harness pins at 35/35. `src/adapters/workspacejson/nodes.ts`
adds `extractDatasetNodes`, which the join uses instead. It accounts for every
node under a checkable invariant:

```text
nodes.length + dropped.length + sum(excluded) === total
```

and distinguishes two outcomes that HAC-162 correctly treats differently:

| Outcome | Meaning | Reported as |
| -- | -- | -- |
| `excluded` | not a dataset-bearing kind (a dbt `test`) | a count per `resource_type` — expected, by policy |
| `dropped` | *is* dataset-bearing but has no `original_file_path` | a **warning naming every node** — unexpected |

`formatDropWarnings()` renders the warning lines. Covered by
`test/adapters/workspacejson/urn-join.integration.test.ts`.

## Scope decision

No demo scoping is required. All five node types resolve, so the join proceeds
as designed across `model` (SQL and Python), `seed`, and `snapshot`. `test`
nodes are excluded by policy — they are not datasets — and that exclusion is
counted, not silent.

The completeness claim HAC-162 gates is therefore: **supported for every node
type verified, with sources carrying the declaration-site caveat above, and
snapshots/Python models verified by probe rather than by the proof corpus.**
