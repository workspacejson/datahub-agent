# Judging guide

Three paths through the project. Each ends at a verified claim rather than a
paragraph of prose.

---

## 60 seconds — see the trap fire

**Open [tally.workspacejson.dev](https://tally.workspacejson.dev).**

The first frame shows a dbt model whose catalog path and repository path differ
by exactly one prefix. DataHub reports `models/curated/game_events.sql`. The
repository holds `dbt/models/curated/game_events.sql`. A naive join between
them returns zero rows, no error, exit code 0 — and an agent working from that
join cannot answer "which file do I edit?"

Tally resolves the URN to the exact file at a pinned revision, shows what the
joined evidence changed about the agent's plan, and names every gap it could
not close.

The deployed build replays a committed capture. The live DataHub instance is
how that capture was made, not what the page is talking to — the checksums
below are what make that verifiable.

---

## What is deliberately not claimed

- **No general completeness claim.** The nested fixture (Transfermarkt) carries
  `complete-against-pinned-manifest` for both upstreams and downstreams, backed
  by HAC-231's readiness manifests. The root fixture (Jaffle Shop) still
  carries `not-established` because no readiness manifest was derived for it.
  Observed counts are not exhaustiveness claims on their own.
- **Behavioral partners are not asserted.** The pinned CLI does not yet emit
  co-change evidence, so Tally has no such records to consume and does not
  guess. History depth is not the evidenced cause: the limitation is evidence
  production.

  <details>
  <summary>Which producer, which field, and the corpus figures</summary>

  `generated.coChange` is defined by `@workspacejson/spec` v0.4 and left
  unemitted by `@workspacejson/cli@0.5.0`, the producer pinned here — its own
  changelog records `coChange` and `fragility` as unemitted. The field is
  therefore absent from every committed workspace artifact, and both golden
  fixtures carry `partners: []` alongside an `indeterminate` entry naming the
  cause rather than an empty list a reader could mistake for a finding.

  Corpus depth, for the record: Transfermarkt has roughly seven years of
  history, first commit 2019-08-04. Jaffle Shop, the root regression corpus, has
  92 commits over about five years, so a co-change figure drawn from *it* would
  be illustrative rather than statistically strong. Neither figure is the reason
  partners are absent.
  </details>
- **No `externalUrl` workaround.** The gap is stated, not papered over. The fix
  is filed upstream.
- **No credential in any committed artifact.** The live evidence package
  explicitly redacts secret values and never stores them.

---

## 5 minutes — is the artifact real?

**Read:** the [README](README.md) top section, both golden fixtures, and the
node-type coverage evaluation. Every artifact named here is committed and can be
inspected without running anything.

**Corpus split.** Two corpora appear on judge surfaces. Transfermarkt (`dcaribou/transfermarkt-datasets@59fa295c`) is the judge-facing demo subject — it exercises the nested `dbt/` project layout where a naive join silently returns zero rows. Jaffle Shop DuckDB (`dbt-labs/jaffle_shop_duckdb@36bde6cb`) is the regression and proof corpus — it backs the node-coverage audit and the clean-room quickstart. A judge who sees both without being told which is the subject cannot read either.

1. Open [`test/fixtures/golden/change-impact-event.nested.json`](test/fixtures/golden/change-impact-event.nested.json).
   This is a real emitted `ChangeImpactEvent` for
   `urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)`,
   with an attached writeback receipt.
2. Check the `code` block: `repositoryRelativePath: "dbt/models/curated/game_events.sql"`,
   `method: "manifest-join"`, `projectPrefix: "dbt"`. The dataset URN resolved
   to a repository file — and the `dbt/` prefix is the normalization that makes
   the join work when the project is nested.
3. Check the `evidence` block: `tier: "VERIFIED"`, one record with
   `checkExecuted: true`. The tier is a function of the records, not an
   assertion.
4. Check the `writeback` block: `succeeded: true`, `bothStatesRead: true`,
   `noop: true`. The write was observed before and after.
5. Check the `unavailable` block: two entries, each stating what is missing and
   why. No empty collection goes unexplained.

**What reading the fixture establishes:**

- A dataset URN resolved to a repository-root-relative source path.
- The evidence tier is mechanically derived from records, not asserted.
- The writeback was observed, not just attempted.
- Every absence is stated, never implied.

Then, if you want the join tested rather than inspected:

1. Open the [nested fixture](test/fixtures/golden/change-impact-event.nested.json)
   and the [root-level fixture](test/fixtures/golden/change-impact-event.root.json).
2. In the nested fixture: `projectPrefix: "dbt"`,
   `dbtFilePath: "models/curated/game_events.sql"`,
   `repositoryRelativePath: "dbt/models/curated/game_events.sql"`. Project
   nested under `dbt/` — paths differ by exactly the prefix. This is the case
   where a naive join silently returns zero rows.
3. In the root fixture: `projectPrefix: ""`, `dbtFilePath: "models/customers.sql"`,
   `repositoryRelativePath: "models/customers.sql"`. Project at repo root —
   paths coincide. This is the Jaffle regression corpus.
4. Open [`evaluation/dbt-node-coverage.md`](evaluation/dbt-node-coverage.md).
   `original_file_path` is populated for every dbt node type tested — model
   SQL, model Python, seed, snapshot, source, test — at dbt 1.12.0, with zero
   nulls. The join does not silently drop nodes.
5. Run the test suite:

   ```bash
   npm test
   ```

   The golden-fixture tests validate both fixtures against the frozen contract,
   the writeback receipt invariants, and the project-layout coverage.

**What you have verified in 5 minutes:**

- The join works for both project layouts (root-level and nested).
- Every dbt node type exposes the path field the join requires.
- The golden fixtures satisfy the contract and the writeback invariants.
- The test suite passes.

---

## 15 minutes — is the evidence real?

**Read:** everything above, plus the live evidence package and the clean
quickstart proof.

1. Open [`evaluation/hac-152/`](evaluation/hac-152/). This is a real run captured
   on 2026-07-29 against a live DataHub instance with a nested dbt project
   (`dcaribou/transfermarkt-datasets@59fa295c`).
2. Verify the checksums:

   ```bash
   cd evaluation/hac-152 && shasum -a 256 -c SHA256SUMS
   ```

3. Open [`live-mcp-event.json`](evaluation/hac-152/live-mcp-event.json). This
   event was read through the official DataHub MCP server over stdio.
   `code.sourceUrl` is null — `externalUrl` is dropped at the MCP boundary.
   The event states this as `not-exposed-by-source` in its `unavailable` block.
4. Open [`live-event-with-writeback.json`](evaluation/hac-152/live-event-with-writeback.json).
   The writeback wrote `VERIFIED` as a structured property, observed the
   before state (`evidenceTier: null`) and the after state (`evidenceTier:
   "VERIFIED"`), and recorded `bothStatesRead: true`. No link was written
   because no commit-pinned URL was available — stated as
   `linkOmittedBecause`.
5. Open [`live-qwen-judge-run-bundle.json`](evaluation/hac-152/live-qwen-judge-run-bundle.json).
   The same model (`qwen-plus`) ran both conditions (DataHub-only and joined)
   under identical task, prompt digest, and temperature-zero settings. The
   comparison produced three deltas: added, removed, and constrained.
6. Open [`evaluation/clean-quickstart-proof.md`](evaluation/clean-quickstart-proof.md).
   This documents a full end-to-end run against a DataHub instance that was
   destroyed and rebuilt immediately beforehand. Eleven conditions are asserted
   from the emitted JSON, not from console output.
7. Open [`evaluation/mcp-field-coverage.md`](evaluation/mcp-field-coverage.md).
   This measures what DataHub holds versus what an agent receives through MCP.
   The probe script exits non-zero when the gap closes, so a future MCP release
   that projects `externalUrl` will fail the record rather than silently leave
   it stating something untrue.
8. Run the full verification suite:

   ```bash
   npm ci
   npm run verify:judging
   ```

   This runs typecheck, lint, clean-room audit, the full test suite (including
   fixture integrity, schema/contract validity, and credential scanning), the
   cockpit production build, and adapter parity in a single PASS/FAIL/SKIP
   ledger. Parity is SKIPped unless `PARITY_OLD_SIDE` is set — see
   `docs/manual-commands.md` for the manual verification path.

**What you have verified in 15 minutes:**

- The evidence is real, not simulated. Checksums match.
- The MCP read path works against a live DataHub instance.
- The writeback was observed before and after, not just attempted.
- The paired plan comparison used identical run parameters for both conditions.
- The clean quickstart proof runs against a rebuilt instance, not a pre-warmed
  one.
- The MCP field coverage gap is measured and will fail honestly if upstream
  fixes it.
- The full verification suite passes: tests, typecheck, lint, clean-room audit,
  production build, and adapter parity.

**What this does not establish.** Steps 1–5 are Transfermarkt evidence you can
verify *as artifact* — the checksums match — but not reproduce *as process*.
Step 6 is the only "destroyed and rebuilt immediately beforehand" claim on this
page, and it rebuilds Jaffle Shop, the regression corpus. If you want to rebuild
the demo corpus itself, that is the next section, and it is deliberately outside
the fifteen minutes.

---

## Rebuild the demo corpus

Transfermarkt is the demo subject and the only corpus that exercises the nested
`dbt/` layout the adapter exists for. It is rebuildable from a clean clone with
no credential, no paid API and no access to this project's tenant:

```bash
scripts/ingest-transfermarkt-corpus.sh --build-only            # no DataHub needed
scripts/ingest-transfermarkt-corpus.sh --gms http://localhost:8080   # build, then ingest
```

<details>
<summary>Full rebuild instructions, prerequisites, and verification</summary>

**Prerequisites.** For `--build-only`: Python 3.11 (set `PYTHON311` if it is not
on `PATH` under that name), `git`, **Node.js** — the lineage derivation and its
digest check run through `scripts/derive-readiness-manifest.mjs` — and network
access to clone the pinned corpus. Ingest additionally needs **`curl`** and a
DataHub instance already running; the script neither creates nor destroys one.

Only `git` and Python are checked up front, so a missing Node or `curl` surfaces
partway through rather than at the prerequisite step. `CORPUS_WORKDIR` controls
where the checkout and virtualenv live; the default is a fresh `mktemp -d`.

**Expected output**, abridged. dbt reports the corpus it parsed, reproducing the
counts in
[`evaluation/corpus-forge-screen.md`](evaluation/corpus-forge-screen.md):

```text
Found 23 models, 97 data tests, 10 sources, 883 macros
```

The script then checks the lineage it derived against the committed readiness
manifests and prints, on success:

```text
=== checking derived lineage against the committed expectation ===
  UPSTREAM  matches 888a1578dcf6048aa1e8e031babac1d0f0db00538f8bb681a030dfe70b784dc6
  DOWNSTREAM  matches 0bd210967c1a5c17de6d45d166c9f38ec934026a37579d49ab37292a7457c260

=== build-only: stopping before ingest ===
corpus     /tmp/transfermarkt-corpus.XXXXXX/transfermarkt
manifest   /tmp/transfermarkt-corpus.XXXXXX/transfermarkt/dbt/target/manifest.json
```

That is a representative excerpt, not a transcript: the `mktemp` suffix is
normalized to `XXXXXX`, and the surrounding dbt log is omitted — including a
block of `MissingArgumentsPropertyInGenericTestDeprecation` warnings the pinned
corpus emits, which are expected and not a failure.

The two digests are the same ones carried by
[`test/fixtures/readiness/`](test/fixtures/readiness/), so a match is a real
comparison against committed expectation rather than a self-check. A mismatch
fails the run rather than warning.

`--build-only` is the boundary between validating the corpus and touching a
catalog: it stops after the digest check, so a judge with no DataHub running can
complete it. A normal invocation is a single process with a single exit code —
the phases are not separate runs — and on failure the diagnostics name the step
that failed alongside the exit code and the work directory, so a build failure
(the corpus or toolchain moved) is distinguishable from an ingest failure (the
catalog did).

**Cleanup.** The script writes to its work directory and, with `--gms`, to the
instance you named. It does not reset or tear down a DataHub — teardown belongs
to whoever owns the instance (`datahub docker nuke` for a quickstart). Remove
the work directory yourself if you set `CORPUS_WORKDIR`; a default `mktemp`
path is left in place so a failed run can be inspected.

**After ingesting, the search index settles asynchronously**, so an immediate
read can be incomplete without erroring. Capture what the catalog currently
holds:

```bash
node scripts/capture-catalog-baseline.mjs --gms http://localhost:8080
```

That command **records** a snapshot; it does not check one, and it exits 0
either way. To confirm the index has settled, compare the two lineage digests it
writes against the committed readiness manifests: matching digests mean the
catalog now holds the topology the fixtures describe. If they differ, the index
is still settling or the ingest was incomplete — wait and capture again.

The capture writes `evaluation/hac-248/catalog-baseline-<timestamp>.json`. Find
the `duck.dev.game_events` entry under `subjects` and check both digests — the
console line prints only their first 16 characters, so read the file rather than
the terminal:

| Capture field | Must equal | Committed source |
| --- | --- | --- |
| `upstream.setDigest` | `888a1578…b784dc6` | `test/fixtures/readiness/game_events.upstream.json` → `expectedSetDigest` |
| `downstream.setDigest` | `0bd21096…7457c260` | `test/fixtures/readiness/game_events.downstream.json` → `expectedSetDigest` |

The recipe is shared with `scripts/derive-readiness-manifest.mjs` — `sha256`
over the sorted URN set — so the values are directly comparable. The capture is
a series instrument by design: one observation of a moving system cannot
establish that it has stopped moving.

For the same check with bounded polling instead of by hand, emit an event
against the pinned manifest:

```bash
node scripts/emit-change-impact-event.mjs \
  "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)" \
  --transport gms --gms http://localhost:8080 \
  --readiness-manifest test/fixtures/readiness/game_events.upstream.json
```

`--transport gms` is not optional here. The emitter defaults to MCP, and this
manifest declares the `searchAcrossLineage` surface — so the default would poll
one surface against an expectation derived for another. Quote the URN: it
contains parentheses and commas the shell would otherwise eat.

It polls to a deadline and upgrades completeness to
`complete-against-pinned-manifest` only once the observed and expected sets are
equal.

**What is verified, and what is not.** `--build-only` has been run from a clean
clone twice — on 2026-08-02 and again on 2026-08-05 — reproducing the counts and
both digests each time. The excerpt above is taken from the second run rather
than written from reading the script, which is why it names dbt's line as dbt's
and the digest lines as the script's.

The ingest limb has **not** been exercised against a freshly rebuilt instance.
That is deferred to HAC-248's clean rebuild, where it becomes that rebuild's own
verification rather than an assumption resting on it. Two builds are also not
stability: both were on one machine, against upstream repositories that can move
under their pins in ways a commit SHA does not catch — a deleted release asset,
a yanked wheel.

</details>

---

## Two corpora, two roles

| Corpus | Purpose | Judge-facing |
| --- | --- | --- |
| Transfermarkt (nested dbt project) | Canonical silent-zero and changed-plan demonstration | Yes |
| Jaffle Shop | Clean-install and integration regression proof | No |

Jaffle Shop's `code.projectPrefix` is `""` — its dbt path and its repository
path are the same string. There is no prefix to normalize, so the silent zero
cannot occur there, and it is not offered in the cockpit's dataset selector. It
is what `scripts/clean-quickstart-proof.sh` rebuilds from the official
quickstart, which is the role it is good at.

Each corpus has its own rebuild script, and they are not interchangeable:
`scripts/clean-quickstart-proof.sh` for Jaffle Shop, and
`scripts/ingest-transfermarkt-corpus.sh` for the demo subject — see
[Rebuild the demo corpus](#rebuild-the-demo-corpus). Reaching for the
clean-quickstart script to reproduce a Transfermarkt claim rebuilds the wrong
corpus and quietly proves nothing about the one under inspection.

---

See [`docs/claims.md`](docs/claims.md) for the full claim ledger.
