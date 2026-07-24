# Clean-room import rule

This repository is a downstream **consumer** of the `workspacejson` standard, not a co-development surface for it.

## Rule

- Only **released, published** `@workspacejson/*` packages (npm/PyPI, as applicable) may be imported. Never import from a sibling checkout, a monorepo path, a git submodule, or any other source-level reference into a `workspacejson` or Marcelle Labs / Vreko repository.
- No copying of source, types, or internal utilities out of `workspacejson/*`, Marcelle Labs, or Vreko repositories into this one. If a released package is missing a capability this application needs, that capability is requested/contributed upstream — it is not reimplemented here by reading upstream source.
- This application must build, run, and pass its own tests using only its own dependency lockfile, with no local path or workspace references to a `workspacejson`, Marcelle Labs, or Vreko checkout.
- This application must remain fully runnable **without** a Vreko daemon present or reachable. Any feature that would require one is out of scope for this repository.

## Why

The application repository advances ecosystem adoption of the neutral, released `workspacejson` interfaces. Blurring the boundary between "consumes the released standard" and "shares implementation with the standard's private producers" would undermine the neutral-producer/public-reference-consumer posture recorded in [HAC-214](https://linear.app/marcelle-labs/issue/HAC-214), and would compromise judge-facing legibility of what is genuinely new work in this repository versus what is reused plumbing.

## Enforcement

- Dependency manifests (`package.json`, `requirements.txt`, etc.) are the source of truth: every `workspacejson`-origin dependency must resolve to a published version, never a local/path/git reference into a private checkout.
- Code review should reject any diff that adds a path-based or git-submodule reference to a `workspacejson`, Marcelle Labs, or Vreko repository.
