# Clean-quickstart proof

The read path, the writeback and the reset, run end to end against a DataHub
that was destroyed and rebuilt immediately beforehand. Everything below is one
transcript from one run.

```bash
scripts/clean-quickstart-proof.sh
```

The script bootstraps its own toolchain and corpus, so it needs only Docker, a
Python 3.11, Node, git and curl. It runs `datahub docker nuke` — point it at a
throwaway instance.

## It fails closed

A proof that can report success on a run where something went wrong is not
evidence, and the first version of this one could. It ran under `set -uo
pipefail` with steps shaped as `cmd 2>&1 | tail`, which reports **tail's** exit
status — so a failed ingest, a failed emit, or a failed writeback printed its
error and the script carried on to the next step and finished cleanly.

What changed:

- `set -Eeuo pipefail` with an `ERR` trap that names the failing step. No `|| true`
  anywhere in the file; where a failure is tolerable it is handled explicitly and
  says why.
- Nothing pipes into `tail`. Output goes to a per-step log and the exit status is
  the command's own.
- The run directory is **deleted** before each run. A step that fails must never
  leave an earlier run's event where a later step can read it and pass.
- Every version the proof states is **pinned and verified after install**, rather
  than inferred from a binary being present. The `[dbt]` extra is checked by
  importing `boto3` and `DBTCoreSource` — the exact import whose absence produced
  the silent ingest failure that made an earlier run read pre-existing data and
  call it fresh.
- The dbt manifest and catalog are regenerated from a `git clean`ed checkout at
  the pin, never accepted from a cached `target/`.
- The eleven conditions below are hard failures, and every one of them is
  asserted by `scripts/assert-proof.mjs` reading the **emitted JSON**, not this
  script's console output. A proof that greps its own transcript is checking the
  formatter.

The assertions: nuke and quickstart succeed · GMS becomes ready · the instance
carries none of this tool's metadata · ingestion finishes with zero failures ·
the subject resolves · lineage reaches the settled condition · both emits produce
**new** valid 1.3 events · the MCP/GMS comparison matches what this document
claims · writeback is `succeeded=true, noop=false` · the repeat is `noop=true` ·
reset is `cleared` · the repeat reset is `already-clean`.

Events are checked to have been produced *during this run* by comparing
`provenance.producedAt` against the run's start, so a stale artifact cannot
satisfy them.

## Environment

Pinned in the script and verified at run time:

| | |
| -- | -- |
| GMS | `v1.5.0.6` (official `datahub docker quickstart`) |
| DataHub CLI | `acryl-datahub[dbt]==1.6.0.16` |
| MCP server | `mcp-server-datahub==0.6.0`, reporting itself as `datahub 3.4.5` |
| dbt | `dbt-duckdb==1.10.1` |
| Python | 3.11, asserted — not "whatever `python3` resolves to" |
| Corpus | `dbt-labs/jaffle_shop_duckdb@36bde6cb`, manifest rebuilt every run |

## The instance was clean

The reset command's dry run, after ingestion and before anything was written:

```text
owns         link "Producing source (workspace.json)" + property workspacejson_evidence_tier
before       link=absent tier=unset
plan         nothing owned was present
disposition  dry-run
```

That is the check, not an assertion about a fresh container. It reports on the
two things this tool can write, which is the only sense in which "clean" is
this tool's to claim.

**The ordering is load-bearing, and it was wrong.** This step originally ran
*before* ingestion, when the subject did not exist. "Nothing owned by this tool
is present" was then trivially true and unverifiable — there was no entity to
hold anything — and the step read as though it had established something. It
only looked like a check because the reset command answered a never-ingested URN
with a clean bill of health; the moment that was fixed, this step failed on the
first run, which is how the vacuous assertion surfaced at all.

After ingestion the claim is real and checkable: the subject exists, it is
readable, and it carries none of this tool's metadata — which is exactly the
precondition the writeback needs. The gate also requires `read === "ok"` before
believing the two nulls, because an unreadable state has null fields too.

## The index converges, and the read waits for it

```text
  converging: upstream_total=0 (~60s)
  converging: upstream_total=0 (~120s)
settled at upstream_total=12 after ~165s (two consecutive equal reads)
{"data":{"dataset":{"graphEdges":{"total":9}}}}
```

For nearly three minutes `searchAcrossLineage` returned **zero** while the graph
already held nine `DownstreamOf` edges. That is the hazard this whole contract is
organised against, observed rather than argued: a lineage read that succeeds,
returns nothing, and is not evidence of anything.

An earlier run of this proof read lineage before waiting, and emitted `0 up / 0
down`. The contract handled it correctly — `indeterminate`, with the reason
stating that the index converges after ingestion, and not `absent`. The wait was
added so the transcript demonstrates the read path rather than the failure mode,
and two consecutive equal reads is the same shape of check
`src/integration/readiness.ts` applies. **It is still not a completeness claim.**
Both events below carry `completeness: "not-established"`, which is correct:
nothing here holds a pinned expected set to compare against. That is
[HAC-231](https://linear.app/marcelle-labs/issue/HAC-231).

## `externalUrl` is dropped at the MCP boundary

The recipe sets `git_info`, so DataHub computes a commit-pinned source URL:

```text
DataHub holds:
  externalUrl    https://github.com/dbt-labs/jaffle_shop_duckdb/blob/36bde6cb…/models/customers.sql

MCP projects to the agent:
  (absent)

DROPPED AT THE MCP BOUNDARY: externalUrl
```

Without `git_info` the catalog holds no URL at all and the probe refuses to
measure — `INCONCLUSIVE`, rather than reporting the gap closed. A missing field
and a dropped field are different facts.

## The same subject, read both ways

```text
transport    official DataHub MCP server over stdio — datahub 3.4.5
lineage      12 up / 1 down
contract     valid

transport    direct DataHub GraphQL/GMS API at http://localhost:8080
lineage      12 up / 1 down
contract     valid
```

```text
upstream URN sets equal  : true (12 edges)
downstream URN sets equal: true (1 edges)
schemaFieldCount         : 7 / 7
code.sourceUrl           : null / null
gmsVersion               : null / "v1.5.0.6"
edge names only on MCP   : 7  (6 upstream, 1 downstream)
```

Two differences, both intended:

- **`gmsVersion`** is null over MCP. No MCP tool reports it. The event states
  `not-exposed-by-source` rather than reaching for a second transport to fill in
  a field an MCP agent could not have had.
- **Seven edge names** — six upstream, one downstream — are populated over MCP
  and null over direct GraphQL. The direct query reads `properties.name` through
  a `... on Dataset` fragment, and the duckdb sibling datasets carry their name
  at the top level. The MCP read is the better of the two here.

> **This number was wrong until the assertions checked it.** Every earlier
> write-up of this proof said *six*, because it was counted from the upstream
> direction alone. The count survived being written into the quickstart, the
> evaluation document, a merged commit message and a Linear comment — read by a
> reader each time, and never recompared against the artifact. It failed on the
> first run where a machine compared the claim to the JSON instead of a person
> comparing it to a previous sentence.
>
> That is the entire thesis of this repository happening to the document that
> argues for it, so it is recorded here rather than quietly corrected.

`code.sourceUrl` is null on **both**, and that is deliberate rather than a
finding. Neither transport requests `externalUrl`: the MCP one cannot, and the
direct one declines to, because an event that varied by transport in what it
claims about source location would make the boundary a matter of which flag was
passed. The cost is stated in the receipt as a scoped omission.

## The writeback, and the five outcomes it keeps apart

From the clean catalog:

```text
before       link=absent tier=unset
after        link=absent tier=VERIFIED
  ok   createStructuredProperty  created urn:li:structuredProperty:workspacejson_evidence_tier
  ok   upsertStructuredProperties
observation  settled after 1 read(s) in 13ms (bound 120000ms)
succeeded    true   noop=false   bothStatesRead=true
```

`created`, not `already defined` — the structured property did not exist. Run
again, unchanged input:

```text
succeeded    true   noop=true   bothStatesRead=true
```

The five facts a consumer must be able to tell apart, as fields rather than
prose:

| fact | field | this run |
| -- | -- | -- |
| success | `succeeded` + `noop` | `true` / `false` |
| noop | `noop` | `true` on the repeat |
| refusal | `refusedBecause` | `null` |
| omission | `linkOmittedBecause` | *"no commit-pinned source URL is available…"* |
| accepted but not observed | `observation.status` | `settled` |

**`observation.status` was `settled` here, so the timed-out case is not
demonstrated by this transcript.** It is a distinguishable field with unit
coverage, and forcing it live means racing the convergence window. Stated rather
than left for a reader to assume the table is fully exercised.

`refusedBecause` is likewise `null` on this subject, because the resolution
succeeded. The omission and the refusal are the two that are easy to conflate,
and this run shows them holding different values at the same time: something
happened, with one part deliberately left out.

## The reset, and what it is allowed to touch

```text
owns         link "Producing source (workspace.json)" + property workspacejson_evidence_tier
before       link=absent tier=VERIFIED
after        link=absent tier=unset
  ok   removeStructuredProperties
verified     1 read(s) in 8ms (bound 60000ms)
disposition  cleared
```

Immediately again:

```text
plan         nothing owned was present
disposition  already-clean
```

`cleared` and `already-clean` are different values because only the first is
evidence that the removal path works. The ownership statement is printed in the
receipt, so what this command may touch is checkable without reading the source.

## What this proof does not establish

- **No completeness claim.** Both events carry `not-established`. Twelve edges
  were observed twice; nothing compared them to a pinned expected set.
- **No `timed-out` observation**, as above.
- **One subject, one corpus.** The nested corpus is not exercised here.
- **`succeeded: true` is about this tool's own metadata** — the evidence tier
  landed and was read back. It says nothing about whether the tier is the right
  tier, which is what `evidence.records` and a reviewer are for.
