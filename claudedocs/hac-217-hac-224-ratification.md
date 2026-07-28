# Contract-to-judge ratification — HAC-217 and HAC-224

Read-only inspection of `workspacejson/datahub-agent`. No writes to the repository,
Linear, or any DataHub instance. 228 tests pass on the inspected branch.

- **Repository:** `workspacejson/datahub-agent`
- **`origin/main` HEAD:** `42c2806` — "Feature/hac 221 lineage completeness gate (#7)",
  single parent `1858970`, i.e. a squash-merge of the HAC-221 branch. Remote
  branch deleted on merge.
- **Inspected working tree:** local `feature/hac-221-lineage-completeness-gate` @ `bba92e2`
- **Tree identity:** `HEAD^{tree}` == `origin/main^{tree}` == `225a5d3`;
  `git diff origin/main..HEAD` is empty. **Every file path, line number, and
  fixture value cited in this document is byte-identical on `main`.**
- **Date of inspection:** 2026-07-27

> **Note on HAC-221's merge.** The four commits `6907917`, `d6c3cc3`, `1261bd2`,
> `bba92e2` are now on `main` via PR #7. They were merged with **4 of 8
> acceptance criteria unmet** (criteria 4, 5, 6, 7, 8 — see the breakdown in
> Section A). Linear still shows HAC-221 `In Progress` with `completedAt: null`,
> which is currently accurate. Marking it Done on the strength of the merge would
> unblock HAC-146 — which blocks HAC-145, HAC-218, HAC-219 and HAC-220 — on work
> that is not finished. Merged is not the same as accepted.

---

## A. Truth reconciliation

| Issue | Planned | Landed | Evidence | Stale tracker state | Remaining blocker |
|---|---|---|---|---|---|
| **HAC-223** | `succeeded` only on observed intent; `noop` intent-relative; dry-run ≠ failed; derivation in `src/`, not the script | **Landed, genuinely** | `deriveOutcome`/`isNoop`/`matchesIntent` at `src/integration/writeback.ts:239-256, 209-215, 195-198`; `notQueriedState` `:99`; `ObservationRecord` `:132`; merged `9d9d0c8` (PR #5) | Issue text specifies `read: "not-read"`; code uses `"not-queried"`. Code is right, issue text is stale | None |
| **HAC-221** | 8 acceptance criteria | **Merged to `main` (PR #7, `42c2806`) with 4 of 8 criteria unmet** — see breakdown below | `scripts/emit-change-impact-event.mjs:62-85,131-182`; `src/integration/change-impact-event.ts:45-92,173-198` | "In Progress" is accurate **today**. The live risk is the opposite of staleness: the merge invites a premature Done, which would falsely unblock HAC-146 | Readiness manifest harness; emitter observation deadline; corpus reference in emitter; false MCP-surface claim |
| **HAC-213** | Producer signal on real pipeline repo + `PATH B: IN\|OUT` ruling | **Not landed** | No artifact records the disposition. `README.md:47` still says "gated behind HAC-213's Path-B ruling" | Todo — accurate | Blocked by META-195/META-198 (upstream, outside this repo) |
| **HAC-146** | Freeze contract | **Partially pre-empted** | `CHANGE_IMPACT_EVENT_VERSION = "1.1"` at `change-impact-event.ts:276` already froze and versioned a shape. But the contract carries **no plan / plan-delta fields at all** | Todo — accurate | Blocked by HAC-221 (open), HAC-213 (open). HAC-223 unblocked |
| **HAC-217** | Judge route + UX freeze | **Not started** | No handoff doc, no storyboard, no wireframes in repo | Todo — accurate | Its own mandatory acceptance is **not satisfiable from committed artifacts** — see Section E |
| **HAC-224** | Cockpit scaffold, npm workspace, Zod | **Not started** | `apps/` does not exist. `package.json` has no `workspaces` key, no React/Vite/Zod/Tailwind deps | Todo — accurate | None technical; sequencing only |
| **HAC-145** | Golden fixture for UI/README/cold judging | **Partially landed under a different issue** | `test/fixtures/golden/change-impact-event.{root,nested}.json` exist and are real runs. But they carry no plan, no plan-delta, no evaluation summary, no LOC baseline | Todo — accurate | HAC-146, HAC-152 |
| **HAC-218 / HAC-219 / HAC-220** | Cockpit views | **Not started** | No `apps/cockpit` | Todo — accurate | HAC-224, HAC-217 |

### HAC-221 acceptance, criterion by criterion

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Zero result records `read: ok`, `observedCount: 0`, `completeness: unverified` — never `absent` | PASS | `emit-change-impact-event.mjs:175-181` emits `indeterminate`, not `absent` |
| 2 | `completeness` a distinct axis; no path derives one from the other | PASS | `LineageObservation` `change-impact-event.ts:173-183`; validator `:411-430` |
| 3 | `indeterminate` added before HAC-146 freeze | PASS | `UnavailableReason` `:45-51`; commit `6907917` |
| 4 | Query failure → `failed`, never empty; `.catch(() => null)` gone, **a test drives it** | PARTIAL | `gqlSafe` `:62-85` replaces it. But no test imports or drives `emit-change-impact-event.mjs`; the 42 tests in `test/integration/change-impact-event.test.ts` exercise `validateEvent`, not the emitter's failure path |
| 5 | Capture harness verifies **exact expected-URN-set equality on two consecutive polls**, records both digests | **FAIL — absent** | `VerificationEvidence` (`:79-93`) is type-only. Nothing constructs one. Only reference outside `src/` is the test at `change-impact-event.test.ts:239-277`. Both golden fixtures carry `completeness: "unverified"` |
| 6 | Observation deadline bounds **every in-flight request**, asserted by a hanging-read test | **FAIL — wrong file** | Implemented in `run-writeback.mjs:167-190` (`observeUntilIntent`, `remainingMs` clamp). The **emitter has no observation window at all** |
| 7 | Nothing in the general emitter references the corpus | **FAIL** | `emit-change-impact-event.mjs:223` hardcodes `test/fixtures/proof-corpus/workspace.json`. Also `:31` hardcodes the jaffle_shop URN as default |
| 8 | "reads the same surface MCP projects" claim remains true, or is amended | **FAIL — false and unamended** | `emit-change-impact-event.mjs:7-9` asserts it. `:188` reads `props.externalUrl` and `:194-204` makes it load-bearing for `method: "external-url"`. `evaluation/mcp-field-coverage.md` documents `externalUrl` as **"DROPPED AT THE MCP BOUNDARY"** for `Dataset`. The emitter reads a field MCP does not project |

Also still present, and named as a defect in HAC-221's own body: `gql` calls
`process.exit(2)` from inside the read path at `emit-change-impact-event.mjs:41`
and `:46`.

### Stale claims in checked-in docs

- `README.md:57` — "27 tests". Actual: **228** across 8 files.
- `README.md:75-77` — lists HAC-163 as "gating HAC-148, HAC-149, HAC-152".
  HAC-148 and HAC-149 **have landed** (`9b2238f` PR #3; `47ba8ee`/`8dcea45` PR #4).
  The README's own gating statement is contradicted by merged code in the same repository.
- **HAC-219** requires showing "the 23/23 nested-path proof". No `23/23` exists
  anywhere in the repository. The only parity figure is `35/35`
  (`docs/provenance.md:101`), which is the META-248 adapter migration harness,
  not a nested-path proof. This number should be cut or re-derived before it
  reaches a judge.
- **PR #7 merged HAC-221 without closing it.** The merge is the moment the
  four unmet criteria become invisible: the code is on `main`, the branch is
  deleted, and nothing in the repository records what was left undone. Either
  HAC-221 stays open until criteria 4–8 land, or a successor issue is filed
  before it is closed. Do not let the merge stand in for the acceptance.

---

## The pinned Transfermarkt proof run

**Status: the run EXISTS. The pin does NOT.**

`evaluation/corpus-forge-screen.md:129-133` states verbatim: *"**Not pinned yet.**
Freezing it at an immutable commit is a decision for the HAC-143 follow-on... HEAD
at screen time was `59fa295c51fc23466f3a71542f8bf3d1335daa83`."*
`evaluation/proof-corpus.md` pins only
`dbt-labs/jaffle_shop_duckdb@36bde6cba69d962b83be1d52fc65a0dce1cb4ebb`.

So the artifact below is a real emitted run against a *screened, unratified*
corpus at a recorded SHA.

Extracted verbatim from `test/fixtures/golden/change-impact-event.nested.json`
(last written by `bba92e2`):

| Field | Exact value |
|---|---|
| `eventVersion` | `1.1` |
| `provenance.producedAt` | `2026-07-27T17:08:07.570Z` |
| `provenance.producer` | `@workspacejson/datahub-agent` `0.0.1` |
| `provenance.datahub.gmsUrl` / `gmsVersion` | `http://localhost:8080` / `v1.5.0.6` |
| `provenance.corpus.repository` | `https://github.com/dcaribou/transfermarkt-datasets` |
| **Repository SHA** | `59fa295c51fc23466f3a71542f8bf3d1335daa83` |
| `provenance.workspaceArtifact` | `producedBy: "@workspacejson/cli"`, `fileIndexKeys: 36` |
| `subject.urn` | `urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)` |
| `datahub.name` / `platform` / `description` | `game_events` / `dbt` / `""` |
| `datahub.schemaFieldCount` / `owners` / `domain` | `2` / `[]` / `null` |
| **dbt project prefix** | `"dbt"` |
| `code.dbtUniqueId` | `model.transfermarkt_datasets.game_events` |
| `code.dbtFilePath` | `models/curated/game_events.sql` |
| `code.repositoryRelativePath` | `dbt/models/curated/game_events.sql` |
| `code.method` | `external-url` |
| `code.sourceUrl` | `https://github.com/dcaribou/transfermarkt-datasets/blob/59fa295c51fc23466f3a71542f8bf3d1335daa83/dbt/models/curated/game_events.sql` |

**Lineage edges — 8 upstream, 1 downstream, exact URNs and degrees:**

```
UPSTREAM (observedCount 8, read ok, completeness unverified)
  dbt    duck.dev.base_game_events                  base_game_events  degree 2
  dbt    duck.dev.base_games                        base_games        degree 2
  dbt    duck.transfermarkt_scraper.game_lineups    game_lineups      degree 3
  dbt    duck.transfermarkt_scraper.games           games             degree 3
  duckdb duck.dev.base_game_events                  (name null)       degree 1
  duckdb duck.dev.base_games                        (name null)       degree 1
  duckdb duck.transfermarkt_scraper.game_lineups    (name null)       degree 4
  duckdb duck.transfermarkt_scraper.games           (name null)       degree 4

DOWNSTREAM (observedCount 1, read ok, completeness unverified)
  duckdb duck.dev.game_events                       (name null)       degree 1
```

**Resolution accounting:** `datasetsRequested 1`, `datasetsResolved 1`,
`datasetsUnresolved 0`, `nodesDropped 0`, `nodesExcluded {}`.

**Writeback receipt:** `succeeded true`, `noop false`, `verified true`,
`refusedBecause null`. Three attempts, all `succeeded: true` —
`createStructuredProperty` (`"already defined"`), `upsertLink`
(`{"upsertLink":true}`), `upsertStructuredProperties`. `before` =
`{linkUrl: null, evidenceTier: null, read: "ok"}`; `after` = intended link +
`VERIFIED`, `read: "ok"`. `observation`: `status settled`, `polls 1`,
`elapsedMs 20`, `timeoutMs 120000`, `lastError null`.

### Plan delta: UNAVAILABLE

There is no plan, and no plan delta, anywhere in the repository. The frozen v1.1
contract (`change-impact-event.ts:283-301`) has no plan, plan-diff, or evaluation
field. `evaluation/` contains `proof-corpus.md`, `corpus-forge-screen.md`,
`dbt-node-coverage.md`, `mcp-field-coverage.md`, `README.md` — no plan-diff
artifact. HAC-150 (the paired DataHub-only vs joined evaluation) has produced
nothing checked in.

### Two defects found in the proof artifact itself

**1. Cross-corpus join contamination.** `emit-change-impact-event.mjs:223`
unconditionally reads `test/fixtures/proof-corpus/workspace.json`. That file's
`_provenance` declares `corpus: https://github.com/dbt-labs/jaffle_shop_duckdb`,
`commit: 36bde6cb…`, `file_count: 36` — it is the **jaffle_shop** artifact. The
Transfermarkt event was therefore joined against the wrong repository's file
index. Its evidence record reads:

> `"claim": "producing file dbt/models/curated/game_events.sql is tracked in the
> workspace.json artifact"`, `"observation": "key absent from generated.fileIndex
> (36 keys)"`, `"verified": true`

The key is absent because the artifact describes a different repository. That
non-membership is then escalated at `emit:241-244` into
`unavailable[0].reason: "absent"` — a **positive claim** under the contract's own
definition (`change-impact-event.ts:29-30`) — resting on evidence that cannot
support it. This is a fifth instance of the exact defect class HAC-221 and
HAC-223 were opened to close, and it is sitting inside the judge-facing golden
fixture.

**2. `absent` is claimable with no completeness statement.** The validator
rejects `absent` + `completeness: "unverified"` (`:472-477`) and requires
completeness on `indeterminate` (`:483-485`), but permits `absent` with
`completeness` **undefined**. Both golden fixtures use exactly that: `partners` /
`reason: "absent"` / no `completeness`. The strongest claim in the vocabulary has
the weakest evidence requirement.

---

## B. Vocabulary collision audit

Raw occurrence counts across `src/`, `scripts/`, `test/fixtures/golden/`:
`verified` 43, `unavailable` 24, `absent` 22, `resolved` 16, `not-queried` 12,
`indeterminate` 10, `noop` 8, `complete` 8, `success` 4.

### "verified" — four incompatible meanings, all visible in one artifact

| Site | Meaning | Citation |
|---|---|---|
| `EvidenceRecord.verified: boolean` | this harness executed the check itself | `change-impact-event.ts:232` |
| `EvidenceTier = "VERIFIED"` | ≥1 record with `verified: true` | `:224`, `deriveTier` `:307-311` |
| `Completeness = "verified"` | answer checked against an external attestation | `:66` |
| `WritebackReceipt.verified` | **both states were read** — explicitly *not* success | `writeback.ts:170-174` |

The nested fixture simultaneously shows `evidence.tier: "VERIFIED"`,
`records[].verified: true`,
`lineageObservation.upstreams.completeness: "unverified"`, and
`writeback.verified: true`. A judge reading that JSON has no way to know these
are four different axes. **A naked "Verified" badge is prohibited, and correctly
so — the word is already overloaded four ways inside the contract.**

### Other collisions

| Word | Colliding senses | Citations |
|---|---|---|
| `resolved` | `ResolutionMethod` / `code.method: "unresolved"`; `accounting.datasetsResolved`; doc-status prose **"RESOLVED 2026-07-26"**; Linear issue status | `:126-133`, `:238`, `proof-corpus.md` limitation 4 |
| `succeeded` | `MutationAttempt.succeeded` (transport returned cleanly) vs `WritebackReceipt.succeeded` (intent observed in the after-state) — **adjacent keys in the same JSON object** | `writeback.ts:47` vs `:167` |
| `absent` | `UnavailableReason.absent` (positive claim) vs prose `"key absent from generated.fileIndex"` in an `EvidenceRecord.observation` | `:47` vs `emit:237` |
| `unavailable` | the `unavailable[]` array (which holds `absent`, `not-queried`, `failed`, `indeterminate`, `not-exposed-by-source`) vs HAC-217's mandated UI label **"Lineage unavailable"** for `read: failed` only | `:300` vs HAC-217 state table |
| `complete` / `completeness` | the `Completeness` axis vs Linear `completedAt` vs prose "complete" | `:66` |
| `not-queried` | consistent across `UnavailableReason`, `ReadStatus`, `LineageObservation.read` (good) — but HAC-223's issue body specifies `"not-read"` | `:48`, `writeback.ts:68`, `:176` |
| `indeterminate` | exists **only** in `UnavailableReason`. `LineageObservation` cannot say it; it encodes the same state as `read: ok` + `completeness: unverified` + `observedCount: 0`. Two encodings of one state | `:49` vs `:173-183` |

### Recommended labels

**Contract renames** (breaking — bundle into the HAC-146 freeze as `1.2`, do not
retrofit):

| Current | Rename to | Why |
|---|---|---|
| `EvidenceRecord.verified` | `checkExecuted` | states the act, not a verdict |
| `EvidenceTier "VERIFIED"` | `EXECUTED` (tiers: `ASSERTED` / `OBSERVED` / `EXECUTED`) | frees "verified" for the completeness axis alone |
| `Completeness "verified"` | keep — **sole surviving owner of the word** | it is the only one carrying `VerificationEvidence` |
| `WritebackReceipt.verified` | `bothStatesRead` | it is a read-coverage fact, not a verdict |
| `WritebackReceipt.succeeded` | `intentObserved` | distinguishes it from `MutationAttempt.succeeded` |

**UI labels — never render a contract enum directly:**

| View-model state | Judge-facing label |
|---|---|
| `read: ok`, `completeness: verified`, `count: 0` | **No lineage in catalog** · checked against readiness manifest |
| `read: ok`, `completeness: unverified`, `count: 0` | **No edges observed** · completeness not established |
| `read: ok`, `completeness: unverified`, `count > 0` | **8 edges observed** · more may still appear |
| `read: ok`, `completeness: verified`, `count > 0` | **8 edges, set matches manifest** |
| `read: failed` | **Lineage read failed** · not a statement about the catalog |
| `read: not-queried` | **Lineage not requested** |
| evidence tier | **Evidence: check executed** / **observed** / **asserted only** |
| writeback | **Write applied and observed** / **Write applied, not yet visible** / **Already correct (no change)** / **Write refused** / **Not attempted (dry run)** |

Every one of these is a two-part label: *claim* + *standing of the claim*. No
single-word terminal badge is permitted anywhere on the judge route.

---

## C. `CockpitViewModel` proposal

Transport-independent, derived from the real contracts (`change-impact-event.ts`
v1.1 + `writeback.ts`). Eight axes modelled independently. Fixture and live
inputs both pass through `parseCockpitViewModel`.

```ts
import { z } from "zod";

/* ── 1. EVIDENCE SOURCE ─────────────────────────────────────── */
// From ContextSource (change-impact-event.ts:24), widened with the join,
// which is neither system alone and must be nameable in the UI.
export const EvidenceSource = z.enum([
  "datahub-declared",       // ContextSource "datahub"
  "workspacejson-observed", // ContextSource "workspacejson"
  "derived-join",           // this harness combined the two
]);

/* ── 2. READ STATUS ─────────────────────────────────────────── */
// LineageObservation.read (:176) and writeback ReadStatus (:68) are the
// same three words. One type, used in both places, never widened.
export const ReadStatus = z.enum(["ok", "failed", "not-queried"]);

/* ── 3. COMPLETENESS + ITS EVIDENCE ─────────────────────────── */
// A discriminated union, so "verified" is UNCONSTRUCTIBLE without evidence.
// The contract enforces this in validateEvent (:360-375); the view model
// enforces it in the type, which is stronger — a component cannot receive
// a verified-without-evidence value at all.
export const VerificationEvidence = z.object({
  manifestDigest: z.string().min(1),
  expectedSetDigest: z.string().min(1),
  observedSetDigest: z.string().min(1),
  queryParameters: z.record(z.union([z.string(), z.number()]))
    .refine((p) => Object.keys(p).length > 0, "queryParameters must not be empty"),
});

export const Completeness = z.discriminatedUnion("state", [
  z.object({ state: z.literal("verified"), evidence: VerificationEvidence }),
  z.object({ state: z.literal("unverified") }),
  // Not in the contract. Present because "completeness is not a meaningful
  // question here" (Unavailable.completeness is optional, :110) is a real
  // third case and must not be silently rendered as "unverified".
  z.object({ state: z.literal("not-applicable"), why: z.string().min(1) }),
]);

/* ── 4. COMPUTATION PHASE ───────────────────────────────────── */
// Nowhere in the contract — the event is an artifact, not a process.
// The cockpit needs it and must NOT overload read status to carry it.
export const ComputationPhase = z.enum([
  "idle", "loading", "ready", "stale", "error",
]);

/* ── 5. LINEAGE OBSERVATION (composed, never collapsed) ─────── */
export const LineageEdge = z.object({
  urn: z.string().min(1),
  name: z.string().nullable(),
  degree: z.number().int().nonnegative(),
});

export const LineageDirection = z.object({
  read: ReadStatus,
  completeness: Completeness,
  // Optional by construction: a read that did not happen has NO count.
  // Manufacturing 0 is the collapse the contract forbids (:116-119).
  observedCount: z.number().int().nonnegative().optional(),
  edges: z.array(LineageEdge),
}).superRefine((d, ctx) => {
  if (d.read !== "ok") {
    if (d.observedCount !== undefined)
      ctx.addIssue({ code: "custom", message: `${d.read} read carries an observedCount` });
    if (d.edges.length > 0)
      ctx.addIssue({ code: "custom", message: `${d.read} read carries edges` });
    if (d.completeness.state === "verified")
      ctx.addIssue({ code: "custom", message: "verified completeness on a read that did not happen" });
  } else {
    if (d.observedCount === undefined)
      ctx.addIssue({ code: "custom", message: "read ok without an observedCount" });
    else if (d.observedCount !== d.edges.length)
      ctx.addIssue({ code: "custom", message: "observedCount disagrees with edges.length" });
  }
});

/* ── 6. TERMINAL DISPOSITION ────────────────────────────────── */
// The only value a badge may render. Every variant is a claim PLUS the
// standing of that claim; there is no bare "verified" member by design.
export const TerminalDisposition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("attested"),      against: z.string().min(1) }),
  z.object({ kind: z.literal("observed"),      standing: z.literal("completeness-unverified") }),
  z.object({ kind: z.literal("asserted"),      why: z.string().min(1) }),
  z.object({ kind: z.literal("read-failed"),   detail: z.string().min(1) }),
  z.object({ kind: z.literal("not-requested"), why: z.string().min(1) }),
]);

/* ── 7. RESOLUTION ACCOUNTING ───────────────────────────────── */
// From ResolutionAccounting (:236-245). Unresolved items must be NAMED,
// not counted — a count cannot be audited by a judge.
export const ResolutionAccounting = z.object({
  datasetsRequested: z.number().int().nonnegative(),
  datasetsResolved: z.number().int().nonnegative(),
  unresolved: z.array(z.object({
    urn: z.string().min(1),
    reason: z.string().min(1),
  })),
  nodesDropped: z.array(z.object({
    uniqueId: z.string().min(1), resourceType: z.string(), reason: z.string(),
  })),
  nodesExcluded: z.record(z.number().int().nonnegative()),
}).superRefine((a, ctx) => {
  if (a.datasetsResolved + a.unresolved.length !== a.datasetsRequested)
    ctx.addIssue({ code: "custom", message: "accounting does not reconcile" });
});

/* ── 8. MUTATION RESULT vs INTENDED-STATE OBSERVATION ───────── */
// Deliberately TWO fields. HTTP/GraphQL success is not visibility.
export const MutationResult = z.object({
  attempts: z.array(z.object({
    mutation: z.string().min(1),
    variables: z.record(z.unknown()),
    accepted: z.boolean(),          // renamed from `succeeded` — transport only
    response: z.string(),
  })),
  allAccepted: z.boolean(),
});

export const IntendedStateObservation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("settled"),   polls: z.number().int().positive(),
             elapsedMs: z.number().int().nonnegative(), timeoutMs: z.number().int().positive() }),
  z.object({ kind: z.literal("timed-out"), polls: z.number().int().positive(),
             elapsedMs: z.number().int().nonnegative(), timeoutMs: z.number().int().positive() }),
  z.object({ kind: z.literal("read-failed"),  lastError: z.string().min(1) }),
  z.object({ kind: z.literal("not-observed"), why: z.string().min(1) }), // dry run / refusal
]);

export const WritebackView = z.object({
  targetUrn: z.string().min(1),
  intended: z.object({ linkUrl: z.string().url(), evidenceTier: z.string() }).nullable(),
  before: z.object({ linkUrl: z.string().nullable(), evidenceTier: z.string().nullable(),
                     read: ReadStatus, readError: z.string().nullable() }),
  after:  z.object({ linkUrl: z.string().nullable(), evidenceTier: z.string().nullable(),
                     read: ReadStatus, readError: z.string().nullable() }),
  mutation: MutationResult,
  observation: IntendedStateObservation,
  // Precomputed by the ADAPTER. A component must never derive this.
  outcome: z.enum(["applied-and-observed", "applied-not-observed",
                   "already-correct", "refused", "not-attempted"]),
  refusedBecause: z.string().nullable(),
  bothStatesRead: z.boolean(),   // was `verified` — no longer a verdict word
});

/* ── ASSEMBLY ───────────────────────────────────────────────── */
export const CockpitViewModel = z.object({
  schemaVersion: z.literal("cockpit-1"),
  sourceMode: z.enum(["fixture", "live"]),   // provenance only — never branches rendering
  phase: ComputationPhase,
  eventVersion: z.literal("1.1"),

  dataset: z.object({
    urn: z.string().min(1), name: z.string().nullable(),
    platform: z.string().nullable(), description: z.string().nullable(),
    owners: z.array(z.string()), domain: z.string().nullable(),
    schemaFieldCount: z.number().int().nonnegative().nullable(),
  }),

  lineage: z.object({ upstreams: LineageDirection, downstreams: LineageDirection }),

  code: z.object({
    dbtUniqueId: z.string().nullable(),
    dbtFilePath: z.string().nullable(),
    repositoryRelativePath: z.string().nullable(),
    projectPrefix: z.string().nullable(),
    method: z.enum(["external-url","dbt-file-path","manifest-join","unresolved"]),
    sourceUrl: z.string().url().nullable(),
  }),

  partners: z.object({
    items: z.array(z.object({
      repositoryRelativePath: z.string().min(1),
      reason: z.string().min(1),
      source: EvidenceSource,
    })),
    // MANDATORY. An empty `items` is never self-describing.
    disposition: TerminalDisposition,
  }),

  evidence: z.object({
    records: z.array(z.object({
      claim: z.string().min(1), observation: z.string().min(1),
      source: EvidenceSource, checkExecuted: z.boolean(),
    })),
    tier: z.enum(["ASSERTED","OBSERVED","EXECUTED"]),
  }),

  accounting: ResolutionAccounting,

  provenance: z.object({
    producedAt: z.string().datetime(),
    producer: z.object({ name: z.string(), version: z.string() }),
    datahub: z.object({ gmsUrl: z.string(), gmsVersion: z.string().nullable() }),
    corpus: z.object({
      repository: z.string().nullable(), commit: z.string().nullable(),
      // NEW, and load-bearing: see the cross-corpus defect above.
      pinned: z.boolean(),
    }),
    workspaceArtifact: z.object({
      producedBy: z.string().nullable(),
      fileIndexKeys: z.number().int().nonnegative(),
      // NEW: proves the artifact describes THIS corpus.
      corpusRepository: z.string().nullable(),
      corpusCommit: z.string().nullable(),
      matchesSubjectCorpus: z.boolean(),
    }).nullable(),
  }),

  writeback: WritebackView.nullable(),

  // Not derivable from the v1.1 contract. Nullable until HAC-150 produces it.
  planDelta: z.object({
    datahubOnly: z.array(z.string()), joined: z.array(z.string()),
    changes: z.array(z.object({
      kind: z.enum(["added","removed","reordered","constrained","uncertainty-changed"]),
      subject: z.string().min(1), reason: z.string().min(1),
      backedBy: z.array(z.string().min(1)).min(1),   // evidence-record claims
    })),
  }).nullable(),

  unavailable: z.array(z.object({
    field: z.string().min(1), source: EvidenceSource,
    disposition: TerminalDisposition, detail: z.string().min(1),
  })),

  limitations: z.array(z.string()),
});
```

**The two invariants that make this worth having:**

1. `Completeness` and `TerminalDisposition` are discriminated unions, so
   `"verified"` / `"attested"` are **unconstructible without their evidence**.
   Zod, not review discipline, prevents the overclaim.
2. `partners.disposition`, `writeback.outcome`, and every
   `unavailable[].disposition` are **precomputed by the adapter**. Components
   receive verdicts; they never see a bare array to count, and never see a
   mutation status to interpret. That satisfies HAC-217's guardrail and
   HAC-224's boundary rule structurally rather than by convention.

**Adapter obligations** (`fixture JSON | live event → CockpitViewModel`): both
modes call the same `toCockpitViewModel(EnrichedChangeImpactEvent)`. `sourceMode`
is metadata only and must not appear in any conditional inside a component. A
round-trip test asserting `toCockpitViewModel(fixture)` deep-equals
`toCockpitViewModel(liveCapture)` for the same subject is the acceptance gate.

---

## D. Adversarial fixture matrix

All eight are constructible today from the v1.1 contract. Only #1 requires new
production code (`VerificationEvidence` has no producer).

| # | Case | Encoding | Required judge label | Blocks the failure |
|---|---|---|---|---|
| 1 | **Complete, manifest-attested** | `read: ok`, `observedCount: 8`, `completeness: verified` + `VerificationEvidence{manifestDigest, expectedSetDigest, observedSetDigest, queryParameters}`. Digests over sorted URN **sets** (`:75-78`) | "8 edges, set matches readiness manifest" | Count-matching-while-members-differ. **Needs HAC-221 criterion 5 built** |
| 2 | **Partial, every unresolved item named** | `accounting.datasetsRequested: 3`, `datasetsResolved: 1`, `unresolved: [{urn, reason} × 2]`; `nodesDropped` as records not integers | "1 of 3 resolved · 2 named below" | A count a judge cannot audit |
| 3 | **Successful read, 0 edges, completeness unverified** | `read: ok`, `observedCount: 0`, `completeness: unverified`, `edges: []`, `unavailable[].reason: "indeterminate"` | "No edges observed · completeness not established" | The HAC-221 headline defect — index lag read as absence |
| 4 | **Failed read** | `read: failed`, **no** `observedCount`, `edges: []`, `unavailable[].reason: "failed"` | "Lineage read failed" — never zero, never absent | Swallowed query failure (`emit:139-141`) |
| 5 | **Not queried** | `read: "not-queried"`, no `observedCount` | "Lineage not requested" | Deliberate non-read reported as fault |
| 6 | **Mutation accepted, intended state not observed** | 3 attempts `accepted: true`; `after.read: "ok"`, `after.linkUrl: null`; `observation.kind: "timed-out"`; `outcome: "applied-not-observed"` | "Write applied · not yet visible in catalog" | The HAC-223 stale-read defect. **This fixture must fail if `outcome` is ever `applied-and-observed`** |
| 7 | **Noop — before already matched intent** | `before` and `after` both carry intended `linkUrl` + tier, both `read: ok`; `outcome: "already-correct"` | "Already correct · no change written" | "Unchanged and wrong" rendered as idempotency (`isNoop` `:209-215`) |
| 8 | **Path-B OUT, no behavioral partner evidence** | `partners.items: []`, `partners.disposition: {kind: "not-requested", why: "HAC-213 Path-B ruled OUT for this window; no co-change surface was queried"}` | "Code partners not requested" | **This is today's real state.** Both golden fixtures currently say `reason: "absent"` here — a positive claim the artifact cannot support |

**Two more I would add, because the repository has already produced both:**

| # | Case | Why |
|---|---|---|
| 9 | **Cross-corpus artifact** | `workspaceArtifact.matchesSubjectCorpus: false`. The nested golden fixture is this case today and does not say so. The cockpit must refuse to render any workspace.json-sourced claim when this is false |
| 10 | **Superseded event version** | `eventVersion: "1.0"` → adapter surfaces `SUPERSEDED_EVENT_VERSIONS["1.0"]` (`:279-282`) as "re-emit required", not a field error |

---

## E. HAC-217 judge route

### Blocking finding, stated before the storyboard

HAC-217's mandatory acceptance requires: *"The DataHub-only / Joined context delta
is the visual hero"* and *"At least one meaningful plan change is shown with an
evidence-backed reason."*

**Neither is satisfiable from committed artifacts.** Running `toDataHubOnly`
(`change-impact-event.ts:321-347`) against the real nested event produces this
complete delta:

| Field | Joined | DataHub-only | Changed? |
|---|---|---|---|
| `partners` | `[]` | `[]` | **no** |
| `code.repositoryRelativePath` | `dbt/models/curated/game_events.sql` | *unchanged* | **no** — the strip applies only to `method === "manifest-join"` (`:330-333`); this run is `external-url` |
| `code.projectPrefix` | `"dbt"` | *unchanged* | **no** |
| `evidence.records` | 2 | 1 | yes |
| `evidence.tier` | `VERIFIED` | `VERIFIED` | **no** — the surviving `datahub` record has `verified: true` |
| `unavailable` | 1 entry | 2 entries | yes |

The delta is one dropped evidence record and one added `unavailable` entry. **The
nested-project normalization — the adapter's stated reason to exist — survives
DataHub-only mode intact, because `externalUrl` carries the prefix.** The `dbt/`
prefix is not a workspace.json contribution on this run; it is a DataHub
contribution that MCP happens to drop.

I am not going to invent a delta. Two honest options:

- **(a) Re-hero the route on the MCP boundary gap.** This is real, measured,
  upstream-filed, and reproducible: `evaluation/mcp-field-coverage.md` shows
  `externalUrl` is `DROPPED AT THE MCP BOUNDARY` for `Dataset`, so an agent
  consuming DataHub *through MCP* holds `models/curated/game_events.sql` with
  nothing to anchor it, while DataHub itself holds the full pinned URL. The hero
  becomes **"what DataHub knows vs. what an MCP agent receives,"** and the
  winning artifact is the writeback that puts the link back where the agent can
  reach it.
- **(b) Keep the DataHub-only/Joined hero and produce the missing evidence
  first** — HAC-213 `PATH B: IN` plus a real `fileIndex` with co-change values,
  then re-emit. That is a multi-day dependency chain and will not land in this
  window.

**Recommendation: (a).** It is the only framing the repository can currently back
with executed checks, and it uses the exact artifacts already committed.
Everything below assumes (a), with the DataHub-only/Joined toggle retained as a
secondary control rather than the hero.

### The five-second first frame

Above the fold, demo width, no scroll. Exact real values only.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  game_events                                              [dbt · DataHub] │
│  urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)       │
│                                                                          │
│  DataHub holds the producing file.  An MCP agent never receives it.      │
│                                                                          │
│   ┌── What MCP projects ─────────┐   ┌── What DataHub holds ───────────┐ │
│   │ dbt_file_path                │   │ externalUrl                      │ │
│   │   models/curated/            │ → │   …/blob/59fa295c…/              │ │
│   │   game_events.sql            │   │   dbt/models/curated/            │ │
│   │                              │   │   game_events.sql                │ │
│   │ project offset:  UNKNOWN     │   │ project offset:  dbt/            │ │
│   └──────────────────────────────┘   └──────────────────────────────────┘ │
│                                                                          │
│   8 edges observed · completeness not established                        │
│                                                                          │
│                                          [ See the change plan  → ]      │
└──────────────────────────────────────────────────────────────────────────┘
```

The five-second read: *a dbt dataset; the agent gets a path it cannot resolve;
DataHub has the answer; the missing piece is the `dbt/` prefix; there is one next
action.* The `dbt/` prefix is the single visual difference between the two panels
— the delta is a **four-character string**, which is exactly why it must be
typographically isolated rather than buried in two long URLs.

`8 edges observed · completeness not established` sits in the first frame
deliberately: the honesty discipline is a feature, not a footnote, and it is the
sentence no competing product prints.

### 60-second storyboard

| t | View | On screen — exact real values | Spoken claim |
|---|---|---|---|
| 0–8s | **Impact** | First frame above | "DataHub knows where this table comes from. An agent reading DataHub through MCP does not." |
| 8–20s | **Impact** | Left-to-right rail: 4 dbt upstreams (`base_game_events` d2, `base_games` d2, `game_lineups` d3, `games` d3) + 4 duckdb siblings → **game_events** → 1 downstream (`duckdb duck.dev.game_events` d1). Header chip: **"8 edges observed · completeness not established"**. Below: `Code partners — not requested (HAC-213 Path-B ruled OUT)` | "Eight upstream edges. We say *observed*, not *all* — the lineage index converges after ingestion, and nothing here proves we saw the whole set." |
| 20–35s | **Change plan** | Two columns. **MCP agent:** `models/curated/game_events.sql` · repository UNKNOWN · commit UNKNOWN · offset UNKNOWN · *cannot open the file*. **This agent:** `dbt/models/curated/game_events.sql` · `dcaribou/transfermarkt-datasets` · `59fa295c` · offset `dbt/` · **[View source ↗]** (live, opens the pinned blob). Toggle: `DataHub-only / Joined` — showing the honest result: evidence records 2 → 1, tier unchanged | "The plan change is: the agent can now open the file. Same catalog, same commit — the difference is one field MCP drops, filed upstream against `acryldata/mcp-server-datahub`." |
| 35–50s | **Receipts** | `<dl>` provenance: producer `@workspacejson/datahub-agent 0.0.1`, GMS `v1.5.0.6`, corpus `dcaribou/transfermarkt-datasets@59fa295c`. Accounting table: requested 1 / resolved 1 / unresolved 0 / dropped 0 / excluded {}. Writeback: `before.linkUrl null` → 3 mutations accepted (`createStructuredProperty` "already defined", `upsertLink`, `upsertStructuredProperties`) → `after.linkUrl` = pinned URL, tier `VERIFIED` → **observation: settled, 1 poll, 20 ms, bound 120 000 ms** | "The receipt does not claim success because the mutation returned 200. It claims success because it re-read the catalog and saw the intended link." |
| 50–60s | **Receipts** | Toggle to fixture #6: identical three accepted mutations, `after.linkUrl: null`, `observation: timed-out`, badge **"Write applied · not yet visible"** | "Here is the same write against a lagging index. Same green mutations. Different verdict. That is the whole product." |

The 50–60s beat is the strongest ten seconds available and should not be cut. It
demonstrates a falsifiable guarantee rather than a happy path — and it is backed
by `deriveOutcome` at `src/integration/writeback.ts:239-256`, which a judge can
read in nineteen lines.

---

## F. UX differentiation

| Product | Borrow | Do **not** copy | Implication here |
|---|---|---|---|
| **DataHub Impact Analysis** ([docs](https://docs.datahub.com/docs/act-on-metadata/impact-analysis)) | Explicit **degree-of-dependencies** control, defaulting to 1 hop; direction toggle; CSV export of the impacted set | The graph-first canvas with filter chips — it presumes the catalog's answer is the answer. Also note the documented Lightning Cache divergence: result sets >300 assets "may include assets that are soft-deleted or no longer exist," while the CSV filters them — an unlabelled completeness gap in the incumbent | Our first frame is **not** a graph. Render the 8 real edges as a bounded rail and spend the saved pixels on the completeness chip DataHub does not print. Record hop params in `queryParameters` (`:91`) so two reads are comparable |
| **Atlan lineage** ([docs](https://docs.atlan.com/product/capabilities/lineage)) | Transformations modelled as first-class **"processes"**, not just edges; column-level granularity; explicit "partial asset" handling | Full-canvas exploration as the entry surface — a judge with 60 seconds cannot explore | Our "process" is the dbt model file, and it is the one node a judge can click through to source. Lead with the file, not the graph |
| **Datafold** ([docs](https://docs.datafold.com/data-diff/what-is-data-diff)) | **Impact delivered into the review surface**, not a separate console: column-level lineage informs the diff, results land in the PR, dual JSON+GUI presentation | Value-level row-by-row diff as the primary surface — wrong granularity; we diff *evidence available to an agent*, not rows | The "dual JSON & GUI" pattern is the model for HAC-219's `<details>` + copy/download raw receipt. The GUI is the claim; the JSON is the audit |
| **Terraform plan** ([docs](https://developer.hashicorp.com/terraform/cli/commands/plan)) | The **plan/apply separation** itself; the saved plan file as a portable artifact containing "your full configuration, all of the values associated with planned changes"; explicit **"no changes"** detection; the symbol grammar `+` `-` `~` `-/+` | The symbols as-is — `~` for "update" is meaningless for evidence. And Terraform's plan is *intent-only*; ours must also carry the **observation** | This is the single closest analogue. `planWriteback` (`writeback.ts:286-318`) is already `terraform plan`; `run-writeback.mjs` is `apply`. Adopt Terraform's **"no changes"** discipline directly as our `already-correct` / noop rendering, and extend the grammar with a symbol Terraform has no need for: *applied but not observed* |
| **LangSmith** ([docs](https://docs.langchain.com/langsmith/observability-concepts)) | Trace→run tree where each run is "a span representing a single unit of work"; inputs/outputs/metadata captured per span; root-run summary above the tree | The full waterfall as a judge surface — 25 000 runs per trace is a debugging tool, not a comprehension tool | Our `attempts[]` array is a three-span trace. Render it as a summary verdict with the spans behind `<details>`. Never make the judge read the tree to learn the outcome |
| **GitHub coding agent** ([docs](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent)) | Work surfaced as a **pull request** — a review artifact the reviewer already knows how to read, with "every step happening in a commit and being viewable in logs" | Its weakness: the docs describe the PR deliverable but **do not** specify a persistent session audit trail. Do not inherit that gap | Our receipt *is* the audit trail, and it is stronger than the PR model because it records the after-state observation. Say so |
| **Temporal Event History** ([docs](https://docs.temporal.io/workflow-execution/event)) | The **append-only log** guarantee — events "cannot be modified, only new events can be added"; strict ordering; the same log serves replay *and* "as an audit log for debugging" | Full event-type enumeration in the UI — too granular | Adopt append-only literally: a receipt is never edited. A re-run emits a **new** receipt with a new `attemptedAt`. This is already how `attachReceipt` (`:346-350`) behaves; make it an explicit, stated guarantee on the Receipts view |

### Where this product is genuinely differentiated

Not on lineage rendering — DataHub and Atlan render lineage better and always
will. Three real differentiators, in descending order of defensibility:

1. **Completeness is a first-class, independently-rendered axis.** DataHub's own
   docs do not distinguish absent edges from unqueried ones, and its Lightning
   Cache divergence is an unlabelled instance of exactly that gap. Atlan's docs
   surface no completeness metric. Datafold's diff is empirical and sidesteps the
   question. **No researched product prints "completeness not established" next
   to a non-zero edge count.** This is the differentiation, and it is enforced in
   code at `change-impact-event.ts:173-198` + `:411-430`, not asserted in copy.
2. **Terraform's plan/apply rigor applied to catalog mutation, plus an
   observation step Terraform does not have.** Terraform plans against
   configuration and applies; it does not then re-read to confirm the change is
   *visible*. `observeUntilIntent` (`run-writeback.mjs:167-190`) polls the
   after-state against intent with a deadline that bounds every in-flight
   request. A receipt that can say "applied but not observed" is a claim none of
   the seven researched products makes.
3. **The dataset→source-file join across the MCP projection gap** — measured,
   upstream-filed, and reproducible without credentials
   (`evaluation/mcp-field-coverage.md`; the probe "exits non-zero when the gap
   closes").

What is **not** differentiated, and should not be claimed: behavioral co-change.
`partners` is `[]` in both golden fixtures, the producer withholds per-file
values by design (`proof-corpus.md` limitation 4), and HAC-213 has not ruled.
Claiming this axis on current evidence would repeat the defect class the whole
project is organized around refusing.

---

## G. Freeze ledger

### HAC-217 must freeze (irreversible; HAC-218/219 cannot start without these)

1. Three views: **Impact → Change plan → Receipts**. No fourth.
2. The 60-second storyboard above, with the **MCP-boundary framing as hero** and
   DataHub-only/Joined demoted to a secondary toggle — plus the written record of
   *why*, so it is not silently reopened.
3. First-frame thesis, primary action (`See the change plan →`), progressive
   disclosure order.
4. **The five semantic lineage states and their exact labels** (Section B table).
   Non-negotiable and already mandated by HAC-217's own state table.
5. **Prohibition on any single-word terminal badge**, "Verified" first among
   them. Every badge is claim + standing.
6. Evidence-source vocabulary: `datahub-declared` / `workspacejson-observed` /
   `derived-join` / dispositioned-unavailable.
7. Reason-first ordering; counts and tiers strictly secondary.
8. The shadcn primitive allowlist exactly as HAC-224 enumerates: Button, Tabs,
   Tooltip, Badge, Separator, Skeleton, ScrollArea, Dialog *or* Sheet,
   Collapsible, one toast.
9. **React Flow admission gate: record it CLOSED.** Nine nodes on one rail. The
   cold-viewer test cannot justify a graph engine at this cardinality, and
   admitting it would delay HAC-218.
10. One desktop demo target + one common-laptop breakpoint.
11. Keyboard/focus semantics; minimum contrast; reduced-motion.

### HAC-224 must freeze provisionally (schema; revisable once, at HAC-146)

1. `CockpitViewModel` field names and the eight independent axes (Section C).
2. `Completeness` and `TerminalDisposition` as **discriminated unions**, so
   overclaim is a type error. This is the one schema decision that is genuinely
   irreversible in spirit — relaxing it later reintroduces the defect class.
3. `MutationResult.allAccepted` and `IntendedStateObservation` as **separate
   fields**. Never merge.
4. Adapter-computed `outcome` / `disposition`; components receive verdicts only.
5. `parseCockpitViewModel` as the sole entry point; `sourceMode` is metadata and
   may not branch rendering.
6. The 10-case fixture matrix (Section D) as the component-test corpus.
7. `provenance.workspaceArtifact.matchesSubjectCorpus` — added now, because the
   cross-corpus defect is live.

### Must wait for HAC-146

1. Final `eventVersion` (`1.1` today; the Section B renames make it `1.2`).
2. The vocabulary renames themselves — `checkExecuted`, `EXECUTED`,
   `bothStatesRead`, `intentObserved`. Bundle into one breaking bump; the
   contract's own migration note (`:264-275`) says re-emit, never upgrade in
   place.
3. Whether `absent` requires an explicit `completeness` (it should; today it does
   not).
4. `planDelta` field names — no upstream source until HAC-150.
5. Input/artifact digests (HAC-146 requires them; the v1.1 contract has none).
6. `VerificationEvidence` producer semantics — two-consecutive-poll set equality,
   per HAC-221 criterion 5.

### Deferred to HAC-220

Visual refinement; motion; final responsive tuning; `@axe-core/playwright` sweep;
manual keyboard review; cold-viewer comprehension runs; production-build
performance measurement.

### Cut

1. **React Flow / any graph-layout engine.** Nine nodes.
2. **A DataHub-only/Joined delta presented as the hero** — the artifacts do not
   support it (Section E).
3. **The "23/23 nested-path proof"** in HAC-219. No such figure exists in the
   repository. Cut it or re-derive it before it reaches a judge.
4. **Any behavioral co-change / fragility claim** until HAC-213 rules
   `PATH B: IN`.
5. Charting library for the evaluation spread; TanStack Table; generic JSON
   viewer on the primary route; Turborepo.
6. Turning HAC-217 into a design system.

---

## H. Execution recommendation

Two independent chains. The critical path is contract-side; the cockpit chain can
run in parallel from the start, because HAC-217 and HAC-224 both consume the
*shape* of the contract, which is already frozen at v1.1.

```
Chain A (contract / evidence)         Chain B (cockpit)
────────────────────────────         ──────────────────────────
HAC-221  finish + merge  ◄────┐      HAC-217  ratify + freeze
   │                          │         │        (needs nothing from A)
   ├─ HAC-213  rule Path B    │         ▼
   │      │                   │      HAC-224  scaffold + Zod + fixtures
   ▼      ▼                   │         │
HAC-146  freeze 1.2 ──────────┴────────►│
   │                                    ├──► HAC-218  Impact + plan views
   ▼                                    └──► HAC-219  Receipts
HAC-145  golden fixture ────────────────────►│
                                             ▼
                                          HAC-220  polish
```

**Ordered sequence, smallest dependency-correct:**

| Step | Issue | Scope — do only this | Why here |
|---|---|---|---|
| **0** | *(HAC-221 scope)* | **Fix the cross-corpus join.** `emit-change-impact-event.mjs:223` must take the workspace.json path as an argument and refuse when its `_provenance.commit` ≠ the subject's corpus commit. Re-emit `change-impact-event.nested.json`. Change `partners` from `absent` to `not-queried`/`indeterminate` where the artifact cannot support `absent` | Half a day. It is the same defect class as HAC-221/223, it is inside the judge-facing fixture, and every downstream consumer inherits it. Cheapest possible fix, highest blast radius |
| **1** | **HAC-221** | Close criteria 4, 6, 7, 8. Build the readiness-manifest harness (criterion 5) as a **separate script**, never in the emitter. Amend or delete the false MCP-surface claim at `emit:7-9`. Remove `process.exit(2)` from `gql`. **Keep HAC-221 open until these land, or file a successor before closing it** | Blocks HAC-146. The first half is already on `main` via PR #7 (`42c2806`); this is the remainder, and the merge has made it easy to lose |
| **2** | **HAC-217** | **Start now, in parallel with step 1.** Ratify the route, record the hero re-framing and its evidence, freeze the eleven items above, record the React Flow gate CLOSED. Produce the checked-in handoff | Depends on nothing in Chain A. It is `Urgent`, due 2026-07-28, and is the longest-lead unblocker for HAC-218/219 |
| **3** | **HAC-224** | Scaffold `apps/cockpit` as one npm workspace. Zod `CockpitViewModel` + adapter + all 10 fixtures + component-test harness + one Playwright smoke. **Stop at the shell** | Needs HAC-217's primitive allowlist and state table (step 2), nothing else. The provisional schema is revisable at step 5 |
| **4** | **HAC-213** | Rule `PATH B: IN \| OUT` and record it. **Do not implement Path B** | Blocks HAC-146. If blocked upstream on META-195/198, rule **OUT for this window** and move on — fixture #8 already models that outcome, so nothing downstream stalls |
| **5** | **HAC-146** | Freeze `1.2`: the vocabulary renames, digests, `absent`-requires-completeness, `planDelta` names. Re-emit both fixtures | Unblocked only once 221's criteria 4–8 actually land — **not** when PR #7 merged. 223 done, 213 ruled. One breaking bump, one re-emit |
| **6** | **HAC-145** | Regenerate the golden fixture against the frozen 1.2 through the HAC-224 Zod boundary. Assert fixture-mode ≡ live-mode `CockpitViewModel` | Needs 146 (shape) + 224 (boundary) |
| **7** | **HAC-218** | Impact + Change plan views | Needs 217 + 224 + 145 |
| **8** | **HAC-219** | Receipts, provenance, writeback proof. **Cut the 23/23 claim** | Parallel with 7 after 145; both consume the same view model |
| **9** | **HAC-220** | Polish, accessibility, cold-viewer runs | Last by definition |

**Three judgement calls worth flagging:**

- **Step 0 is not in any issue's scope today.** File it under HAC-221 — same
  defect class, same file — rather than opening a new issue, so it does not queue
  behind ratification.
- **Steps 2–3 must not wait for step 1.** HAC-217 is due tomorrow and blocks
  HAC-218. Nothing in HAC-217's deliverable depends on HAC-221 merging; it
  depends on the *shape*, which is frozen.
- **HAC-213 should be ruled OUT rather than left open.** It blocks HAC-146, which
  blocks HAC-145, which blocks HAC-218/219/220 — the entire judge-facing chain.
  An explicit `OUT` costs one recorded decision and unblocks five issues; leaving
  it Todo costs the submission. Fixture #8 already models `OUT` honestly, so
  nothing is lost but the co-change claim, which the evidence does not currently
  support anyway.

---

## Source index

### Repository (`origin/main` @ `42c2806`; identical tree inspected at `bba92e2`)

- `src/integration/change-impact-event.ts` — frozen v1.1 contract, `validateEvent`, `toDataHubOnly`, `deriveTier`
- `src/integration/writeback.ts` — `deriveOutcome`, `matchesIntent`, `isNoop`, `planWriteback`, receipt types
- `scripts/emit-change-impact-event.mjs` — DataHub read path and event emitter
- `scripts/run-writeback.mjs` — writeback apply + `observeUntilIntent`
- `test/fixtures/golden/change-impact-event.nested.json` — the Transfermarkt run
- `test/fixtures/golden/change-impact-event.root.json` — the jaffle_shop run
- `test/fixtures/proof-corpus/workspace.json` — real `@workspacejson/cli@0.5.0` run, 36 keys, jaffle_shop
- `test/fixtures/proof-corpus/manifest.json` — dbt 1.12.0 / duckdb manifest, jaffle_shop
- `evaluation/proof-corpus.md` — HAC-143 pin and its recorded limitations
- `evaluation/corpus-forge-screen.md` — Transfermarkt screen; "Not pinned yet"
- `evaluation/mcp-field-coverage.md` — `externalUrl` dropped at the MCP boundary
- `evaluation/dbt-node-coverage.md` — HAC-162 `original_file_path` coverage
- `README.md` — ownership ruling, dependency boundary, status (contains stale claims)

### Commits

`42c2806` (origin/main HEAD — HAC-221 squash-merge, PR #7) ·
`bba92e2` `1261bd2` `d6c3cc3` `6907917` (the four HAC-221 commits, now on main) ·
`1858970` (PR #6, prior main HEAD) ·
`9d9d0c8` (HAC-223, PR #5) · `124d26c` (PR #4) · `8dcea45` `47ba8ee` (HAC-149) ·
`9b2238f` (HAC-148, PR #3) · `b76a8f6` `8f3d4f2` (HAC-156, PR #2) ·
`886e54b` (real producer run) · `7478e7b` (adapter adoption / corpus freeze)

### Linear

[HAC-145](https://linear.app/marcelle-labs/issue/HAC-145) ·
[HAC-146](https://linear.app/marcelle-labs/issue/HAC-146) ·
[HAC-213](https://linear.app/marcelle-labs/issue/HAC-213) ·
[HAC-217](https://linear.app/marcelle-labs/issue/HAC-217) ·
[HAC-218](https://linear.app/marcelle-labs/issue/HAC-218) ·
[HAC-219](https://linear.app/marcelle-labs/issue/HAC-219) ·
[HAC-220](https://linear.app/marcelle-labs/issue/HAC-220) ·
[HAC-221](https://linear.app/marcelle-labs/issue/HAC-221) ·
[HAC-223](https://linear.app/marcelle-labs/issue/HAC-223) ·
[HAC-224](https://linear.app/marcelle-labs/issue/HAC-224)

### Official product references

- DataHub Impact Analysis — https://docs.datahub.com/docs/act-on-metadata/impact-analysis
- Atlan lineage — https://docs.atlan.com/product/capabilities/lineage
- Datafold data diff — https://docs.datafold.com/data-diff/what-is-data-diff
- Terraform plan — https://developer.hashicorp.com/terraform/cli/commands/plan
- LangSmith observability concepts — https://docs.langchain.com/langsmith/observability-concepts
- GitHub Copilot coding agent — https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent
- Temporal Event History — https://docs.temporal.io/workflow-execution/event
