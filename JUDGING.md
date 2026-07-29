# Judging guide

Three paths through the project, each ending at a verified claim rather than a
paragraph of prose. Every artifact named here is committed and can be inspected
without running anything.

---

## 60 seconds — what is this?

**Read:** the [README](README.md) top section and the root-level golden fixture.

1. Open [`test/fixtures/golden/change-impact-event.root.json`](test/fixtures/golden/change-impact-event.root.json).
   This is a real emitted `ChangeImpactEvent` for
   `urn:li:dataset:(urn:li:dataPlatform:dbt,jaffle_shop.main.customers,PROD)`,
   with an attached writeback receipt.
2. Check the `code` block: `repositoryRelativePath: "models/customers.sql"`,
   `method: "manifest-join"`. The dataset URN resolved to a repository file.
3. Check the `evidence` block: `tier: "VERIFIED"`, one record with
   `checkExecuted: true`. The tier is a function of the records, not an
   assertion.
4. Check the `writeback` block: `succeeded: true`, `bothStatesRead: true`,
   `noop: true`. The write was observed before and after.
5. Check the `unavailable` block: two entries, each stating what is missing and
   why. No empty collection goes unexplained.

**What you have verified in 60 seconds:**

- A dataset URN resolved to a repository-root-relative source path.
- The evidence tier is mechanically derived from records, not asserted.
- The writeback was observed, not just attempted.
- Every absence is stated, never implied.

---

## 5 minutes — does the join actually work?

**Read:** the README, the golden fixtures, and the node-type coverage evaluation.

1. Open the [root-level fixture](test/fixtures/golden/change-impact-event.root.json)
   and the [nested fixture](test/fixtures/golden/change-impact-event.nested.json).
2. In the root fixture: `projectPrefix: ""`, `dbtFilePath: "models/customers.sql"`,
   `repositoryRelativePath: "models/customers.sql"`. Project at repo root —
   paths coincide.
3. In the nested fixture: `projectPrefix: "dbt"`,
   `dbtFilePath: "models/curated/game_events.sql"`,
   `repositoryRelativePath: "dbt/models/curated/game_events.sql"`. Project
   nested under `dbt/` — paths differ by exactly the prefix. This is the case
   where a naive join silently returns zero rows.
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
   npm test
   npm run typecheck
   npm run check:clean-room
   npm run parity:datahub-adapter
   ```

**What you have verified in 15 minutes:**

- The evidence is real, not simulated. Checksums match.
- The MCP read path works against a live DataHub instance.
- The writeback was observed before and after, not just attempted.
- The paired plan comparison used identical run parameters for both conditions.
- The clean quickstart proof runs against a rebuilt instance, not a pre-warmed
  one.
- The MCP field coverage gap is measured and will fail honestly if upstream
  fixes it.
- The full verification suite passes: tests, typecheck, clean-room audit, and
  adapter parity.

---

## What is deliberately not claimed

- **No completeness claim.** Every lineage read carries `not-established`.
  Observed counts are not exhaustiveness claims.
- **No statistical co-change evidence.** The proof corpus has 92 commits over
  five years. Any co-change figure is illustrative, not statistical.
- **No `externalUrl` workaround.** The gap is stated, not papered over. The fix
  is filed upstream.
- **No credential in any committed artifact.** The live evidence package
  explicitly redacts secret values and never stores them.

See [`docs/claims.md`](docs/claims.md) for the full claim ledger.
