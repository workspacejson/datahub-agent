# Adoption provenance — the workspace.json DataHub/dbt adapter

Recorded per [META-248](https://linear.app/marcelle-labs/issue/META-248). This
document states where `src/adapters/workspacejson/` came from and what was
verified at adoption.

## Source

| Field | Value |
| -- | -- |
| Frozen migration baseline | `workspacejson/cli@c60447fc7e6b191ea4400d2e2631cb5ffc18b5c5` |
| Baseline path | `packages/datahub-adapter/` |
| Baseline commit subject | Merge PR #3 — `[CLI] META-247 — land the ratified neutral package architecture` |
| Baseline commit date | 2026-07-26 |
| Pre-migration origin | `workspace-json/agents-audit@e47eb1b8556c4f361db9a78190a2f36b400756e8`, `packages/cli/` |
| Adopted into | `workspacejson/datahub-agent`, `src/adapters/workspacejson/` |
| Adoption date | 2026-07-26 |

## What was adopted

Five source files, as an **internal module — not a package**. META-248 ratified
this shape to avoid creating a second public package and a semver obligation.
Promotion to `packages/workspacejson-adapter/` happens only if a second real
DataHub application consumes it — decided by observed reuse, not anticipated
reuse.

```text
src/adapters/workspacejson/
  index.ts       public surface: 7 functions, 5 types
  normalize.ts   dbt path normalization
  join.ts        join against generated.fileIndex
  dbt.ts         manifest extraction + multi-project discovery
  cli.ts         adapter entry point
```

Tests and fixtures moved alongside, to `test/adapters/workspacejson/`.

## Source identity

The adopted files were compared against the **pre-migration** originals at
`workspace-json/agents-audit@e47eb1b8`, not merely against the staging copy.
Four of five are byte-identical across the entire chain
(`agents-audit` → `cli` → `datahub-agent`):

```text
index.ts       IDENTICAL
normalize.ts   IDENTICAL
join.ts        IDENTICAL
cli.ts         IDENTICAL
dbt.ts         type-only deviation, 2 substitutions (below)
```

This is a stronger claim than behavioral parity, and it is machine-checked as
section 0 of `migration/parity-datahub-shim.mjs`.

### The one deviation, and why

`dbt.ts` line 1 and line 40:

```diff
-import { readdirSync } from "node:fs";
+import { readdirSync, type Dirent } from "node:fs";

-    let entries: ReturnType<typeof readdirSync>;
+    let entries: Dirent[];
```

Upstream, `packages/datahub-adapter/tsconfig.json` included
`../../types/ambient.d.ts`, which **shadows `node:fs`** with a hand-written
stub declaring a minimal `Dirent`. `ReturnType<typeof readdirSync>` resolved
against that stub, not against `@types/node`.

This application does not carry that shim, deliberately: an ambient module
override that shadows `node:fs` would mask type errors across the whole
application, and copying it would widen the clean-room exception for no benefit.
Against real `@types/node@22.19.17`, the original expression selects the Buffer
overload and **fails to compile** (4 errors, `TS2322`/`TS2367`/`TS2345`).

Both substitutions are type-level — a `type`-only import specifier and a
variable annotation. TypeScript erases both, so no runtime behavior changes.
The parity harness proves this two ways: it reverses the documented
substitutions and re-compares against the baseline, and sections 2–5 re-run the
full behavioral comparison against the pre-migration module regardless.

**This was a latent defect the upstream shim was masking, not a defect
introduced here.** It is worth reporting upstream.

## Parity

`migration/parity-datahub-shim.mjs`, ported from the baseline's harness and
re-pointed at the DataHub-owned candidate.

```bash
npm run parity:datahub-adapter
```

Result: **35 passed, 0 failed**, plus 5/5 source identity.

### Substitutions in the 35

META-248 required both "internal module, not a package" and "preserve its 35/35
behavior". Section 1 of the original harness asserted on `package.json` fields
that an internal module does not have, so 7 of the 35 were structurally
unsatisfiable as written. Each was restated as the adoption-equivalent
invariant carrying the same intent, and is labeled `[RESTATED]` in the output.

| # | Original (package assertion) | Restated (adoption equivalent) |
| -- | -- | -- |
| 1 | renamed to an accurate identity | adopted as an internal module — no package identity of its own |
| 2 | version unchanged: 0.0.1 | provenance recorded against the frozen baseline (section 0 clean) |
| 3 | STILL PRIVATE (`private:true`) | STILL UNPUBLISHABLE — host application is `private:true` |
| 4 | bin surrendered `workspacejson` | declares NO bin — cannot collide with the neutral CLI command |
| 5 | exports/main/types unchanged | public surface unchanged — same 7 functions re-exported |
| 6 | declares NO generate command | unchanged in intent; asserted against the application manifest |
| 7 | no dep on agents-audit / rules | unchanged in intent; asserted against the application manifest |

Sections 2–5 (28 checks) are ported **verbatim**.

The harness also changed how it loads both sides: the original imported built
`dist/index.js` and spawned `node dist/cli.js`. Neither side is built here —
both run from TypeScript source under the `tsx` loader. Same entry points, same
argv, same exit codes; no behavior is mediated by a build step.

The `old` side is fetched from the public `workspace-json/agents-audit`
repository into `.parity-cache/` on first run. Set `PARITY_OLD_SIDE` to point at
an existing checkout instead.

## What was added, not adopted

The adopted module had no URN handling — it covered `dbt → fileIndex` but never
`URN → dbt`. Two modules were added **alongside** the frozen five, so the
parity baseline stays pinned:

| File | Purpose |
| -- | -- |
| `urn.ts` | DataHub dataset URN → dbt manifest node ([HAC-147](https://linear.app/marcelle-labs/issue/HAC-147)) |
| `nodes.ts` | non-silent node extraction ([HAC-162](https://linear.app/marcelle-labs/issue/HAC-162)) |

`nodes.ts` exists because the adopted `extractModels` filters
`resource_type === "model"` **and** silently requires a truthy
`original_file_path`. Measured against the frozen proof corpus it discards 23 of
28 nodes without a word. HAC-162's bar is explicit: *"a dropped node must warn,
not vanish."* `extractModels` is left untouched — it is the behavior the parity
harness pins — and `extractDatasetNodes` is the accountable path the join uses.

## Boundary

- No schema changes. `workspacejson/standard` owns contracts.
- No producer behavior changed in `workspacejson/cli`.
- Nothing published. The adapter has never been on npm and stays unpublished.
- The only `workspacejson`-origin runtime dependency is `@workspacejson/spec`,
  pinned to the published `0.4.4` — verified present on the public registry.
