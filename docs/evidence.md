# Evidence terminology and invariants

This document defines every term a cold reader will meet in a
`ChangeImpactEvent` and states the invariants the contract enforces. It is the
reference a judge or reviewer should consult when a field reads oddly — the
oddity is almost always deliberate.

---

## The core principle

**Every fact carries its origin. Every absence is stated, never implied.**

A `ChangeImpactEvent` is not a summary of what was found. It is a record of
what was asked, what answered, what was whole, what was missing, and why —
kept on axes that are deliberately not collapsed into each other.

---

## Axes of evidence

### `read` — did the catalog answer?

| Value | Meaning |
| -- | -- |
| `ok` | The query returned a result. Does not mean the result is complete. |
| `failed` | The query was sent and the catalog returned an error or no response. |
| `not-queried` | The query was not sent. The field is scoped out of this run, not empty. |

**`failed` and `not-queried` are not claims about the data.** Collapsing them
into "no data" is the error the whole contract exists to prevent. A lineage
read that failed is not the same as a lineage read that returned zero edges,
and neither is the same as a lineage read that was never attempted.

### `completeness` — was the answer whole?

| Value | Meaning |
| -- | -- |
| `complete-against-pinned-manifest` | The observed count matches a pinned expected set. |
| `not-established` | The observed count is what was seen. No claim that it is the whole. |

**`not-established` is honest, not a shortfall.** DataHub's lineage is
search-index backed, and that index converges after ingest — so a query can
return four edges of twelve, succeed, and look identical to a complete answer.
`not-established` is the usually correct state for lineage reads. Promoting it
to `complete` requires a pinned manifest that enumerates the expected edges,
and that pin is itself evidence.

### `unavailable[].reason` — why is something missing?

| Value | Meaning |
| -- | -- |
| `absent` | Asked, and the source reported nothing. The strongest form of "not there." |
| `not-queried` | Not asked. Scoped out of this run, not empty. |
| `failed` | Asked, and the source returned an error. |
| `indeterminate` | The query succeeded, returned something, and completeness is unknown. Exists because the other three could not express it. |
| `not-exposed-by-source` | The source holds the field but does not project it to this consumer. |

**Each `unavailable` entry carries a `source`** (`datahub` or `workspacejson`),
the `field` it explains, a human-readable `detail`, and optionally
`completeness` and `observedCount` for lineage-shaped absences.

### `evidence.records[].checkExecuted` — what backs a claim?

`checkExecuted: true` records that a check ran. It does not say the claim is
true — that is what `observation` records and what a reviewer judges. A record
without a check is still a record; it carries less weight, and the tier
derivation accounts for that.

### `evidence.tier` — the mechanical summary

| Tier | Meaning |
| -- | -- |
| `ASSERTED` | At least one record, none with `checkExecuted: true`. |
| `OBSERVED` | At least one record with `checkExecuted: true`. |
| `VERIFIED` | All records have `checkExecuted: true`. |

**The tier is a function of the records, not an assertion.** `deriveTier` is
pure: given the records, the tier is determined. `VERIFIED` is never rendered
alone — it carries the record count that produced it, so a reader can see
whether "VERIFIED" means one check or twenty.

---

## Invariants

### 1. No silent zeros

Every empty collection (`upstreams`, `downstreams`, `partners`) has a
corresponding `unavailable` entry explaining why it is empty. An empty array
without an `unavailable` entry fails validation.

**Test:** `test/integration/golden-fixture.test.ts` — "states every absence
rather than leaving an empty collection unexplained."

### 2. Node accounting

```
nodes.length + dropped.length + sum(excluded) === total
```

Every dbt node in the manifest is accounted for as *kept*, *dropped*, or
*excluded by policy*. A node that is dataset-bearing but has no resolvable
source file produces a warning that names it.

### 3. Origin on every fact

Every piece of context carries its `source` (`datahub` or `workspacejson`).
A reviewer can tell which system supplied which fact, and the `toDataHubOnly`
projection removes workspace.json facts while recording each removal as
`not-queried`.

### 4. Pinned source links

When `code.sourceUrl` is non-null, it contains `/blob/<commit>/` — a
commit-pinned GitHub link. An unpinned or branch-relative link fails validation.

**Test:** `test/integration/golden-fixture.test.ts` — "pins the source link to
an immutable commit when it has one at all."

### 5. Observed writeback

`succeeded: true` requires mutations to have been accepted **and** the intended
state observed. `bothStatesRead: true` says the before and after states were
both read. A mutation returning cleanly is not evidence that the write is
visible — DataHub serves stale reads for some seconds afterwards.

### 6. No human-authored fields written

The writeback writes only a labelled link and an evidence-tier structured
property. Anything under `editableProperties`, `description`, `fragility`, or
`riskScore` fails the attempt audit.

**Test:** `test/integration/golden-fixture.test.ts` — "wrote nothing
human-authored, as recorded in the attempts themselves."

### 7. No credentials in committed artifacts

Every committed JSON artifact is scanned for `token`, `password`, `secret`, and
`authorization` fields. A credential that is not explicitly redacted fails.

**Test:** `test/integration/golden-fixture.test.ts` — "carries no credential,
since the fixture is committed."

### 8. Contract version drift

The TypeScript interfaces and Zod schemas are drift-guarded. A field added to
the interface but not the schema (or vice versa) fails at compile time.

**Source:** `src/integration/change-impact-event.ts` — drift guards after the
schema definitions.

---

## The `externalUrl` gap

DataHub computes a commit-pinned source URL for every dbt dataset at ingestion
time. **The official MCP server does not project it for datasets.** This is not
a choice this tool makes — there is no MCP tool that returns it.

The consequence: `code.sourceUrl` is null under the MCP read path, and the
writeback states a scoped link omission (`linkOmittedBecause`). The fix is a
one-line projection change, filed upstream against
`acryldata/mcp-server-datahub`.

See [`evaluation/mcp-field-coverage.md`](../evaluation/mcp-field-coverage.md)
for the measurement, the probe script, and the honest-limits section.

---

## The `toDataHubOnly` projection

`toDataHubOnly(event)` produces a copy of the event with all `workspacejson`
facts removed. Each removed field is recorded as `not-queried` in the
`unavailable` list, so the projection reads as scoped rather than empty.

The DataHub-only event still satisfies the contract — `validateEvent` returns
`[]` on the projected copy. This is what makes the plan comparison meaningful:
both conditions are valid events, and the difference between them is the
evidence the join added.

---

## Versioning

The contract is versioned (`CHANGE_IMPACT_EVENT_VERSION`, currently `"1.3"`).
Superseded versions are listed in `SUPERSEDED_EVENT_VERSIONS`. A version bump
is a breaking change; the golden fixtures must be re-emitted and the tests
must pass against the new version.
