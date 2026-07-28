# Clean-quickstart proof

The read path, the writeback and the reset, run end to end against a DataHub
that was destroyed and rebuilt immediately beforehand. Everything below is one
transcript from one run.

```bash
scripts/clean-quickstart-proof.sh
```

The script bootstraps its own toolchain and corpus, so it needs only Docker, a
Python 3.11 and Node. It runs `datahub docker nuke` — point it at a throwaway
instance.

## Environment

| | |
| -- | -- |
| GMS | `v1.5.0.6` (official `datahub docker quickstart`) |
| DataHub CLI | `1.6.0.16` |
| MCP server | `mcp-server-datahub` `0.6.0`, reporting itself as `datahub 3.4.5` |
| Corpus | `dbt-labs/jaffle_shop_duckdb@36bde6cb`, built with `dbt-duckdb==1.10.1` |

## The instance was clean

The reset command's dry run, before anything was written:

```text
owns         link "Producing source (workspace.json)" + property workspacejson_evidence_tier
before       link=absent tier=unset
plan         nothing owned was present
disposition  dry-run
```

That is the check, not an assertion about a fresh container. It reports on the
two things this tool can write, which is the only sense in which "clean" is
this tool's to claim.

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
edge names differing     : 6
```

Two differences, both intended:

- **`gmsVersion`** is null over MCP. No MCP tool reports it. The event states
  `not-exposed-by-source` rather than reaching for a second transport to fill in
  a field an MCP agent could not have had.
- **Six edge names** are populated over MCP and null over direct GraphQL. The
  direct query reads `properties.name` through a `... on Dataset` fragment, and
  the duckdb sibling datasets carry their name at the top level. The MCP read is
  the better of the two here.

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
