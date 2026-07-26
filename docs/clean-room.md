# Clean-room import rule

This repository is a downstream **consumer** of the `workspacejson` standard, not a co-development surface for it.

## Rule

- Only **released, published** `@workspacejson/*` packages (npm/PyPI, as applicable) may be imported. Never import from a sibling checkout, a monorepo path, a git submodule, or any other source-level reference into a `workspacejson` or Marcelle Labs / Vreko repository.
- No copying of source, types, or internal utilities out of `workspacejson/*`, Marcelle Labs, or Vreko repositories into this one. If a released package is missing a capability this application needs, that capability is requested/contributed upstream — it is not reimplemented here by reading upstream source.
- This application must build, run, and pass its own tests using only its own dependency lockfile, with no local path or workspace references to a `workspacejson`, Marcelle Labs, or Vreko checkout.
- This application must remain fully runnable **without** a Vreko daemon present or reachable. Any feature that would require one is out of scope for this repository.

## Recorded exception — the META-248 adapter adoption (2026-07-26)

`src/adapters/workspacejson/` was **transferred into this repository**, not
imported or reimplemented. It is the one standing exception to the second rule
above, and it is closed: it applies to this transfer and to nothing else.

Why it is not a clean-room breach:

- It is an **ownership transfer, not a shared implementation**. The code is
  DataHub *consumer* logic (dbt path normalization, URN-to-file joins,
  consumer-side failure reporting) that was parked in `workspacejson/cli` only
  because [META-240](https://linear.app/marcelle-labs/issue/META-240) had to
  preserve it somewhere while its permanent owner was decided. It was never
  neutral producer logic. `workspacejson/cli` **removes** it — the two
  repositories do not both hold it.
- It creates **no ongoing dependency** on a `workspacejson` checkout. Nothing
  in this repository imports `@workspacejson/cli`, which is in any case
  unpublished. The only `workspacejson`-origin runtime dependency remains
  `@workspacejson/spec`, pinned to the published `0.4.4`.
- The transfer is **fully attributed**. Judge-facing legibility is the point of
  the rule, and it is served better by a recorded provenance trail than by
  silence: see [`provenance.md`](provenance.md) for the frozen baseline commit,
  per-file source identity, the single documented deviation, and the 35/35
  parity result.

What this exception does **not** license:

- copying any further source, types, or utilities out of `workspacejson/*`,
  Marcelle Labs, or Vreko repositories;
- importing `@workspacejson/cli` at any level, released or otherwise;
- carrying upstream build shims. The upstream `types/ambient.d.ts` was
  deliberately **not** adopted — see `provenance.md`.

Any future transfer of this kind requires its own recorded ruling. It is not
covered by this one.

## Why

The application repository advances ecosystem adoption of the neutral, released `workspacejson` interfaces. Blurring the boundary between "consumes the released standard" and "shares implementation with the standard's private producers" would undermine the neutral-producer/public-reference-consumer posture recorded in [HAC-214](https://linear.app/marcelle-labs/issue/HAC-214), and would compromise judge-facing legibility of what is genuinely new work in this repository versus what is reused plumbing.

## Enforcement

- Dependency manifests (`package.json`, `requirements.txt`, etc.) are the source of truth: every `workspacejson`-origin dependency must resolve to a published version, never a local/path/git reference into a private checkout.
- Code review should reject any diff that adds a path-based or git-submodule reference to a `workspacejson`, Marcelle Labs, or Vreko repository.
