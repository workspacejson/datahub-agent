# datahub-agent

Public, Apache-2.0 reference application consuming released [`workspacejson`](https://github.com/workspacejson) interfaces against [DataHub](https://datahubproject.io/). Built for the *Build with DataHub: The Agent Hackathon*.

## What this repository is — and isn't

This ecosystem spans three distinct repositories. Do not conflate them:

| Repository | Role | Owner |
|---|---|---|
| `workspacejson/*` (schema, `@workspacejson/cli`, producer) | The neutral standard and producer. Defines workspace.json, the four stable read paths, and neutral producer conformance. | workspacejson |
| **`workspacejson/datahub-agent`** (this repo) | The DataHub **application**: orchestration, official DataHub MCP consumption, dbt/DataHub URN-to-source-file joins, OSS-safe writeback, evaluation, demo assets. | workspacejson |
| External pipeline proof corpus | The public dbt/pipeline repository used as the measurement and demo surface. Selected and pinned at an immutable commit by [HAC-143](https://linear.app/marcelle-labs/issue/HAC-143). | n/a (external, third-party) |

This repository owns none of: the workspace.json schema, `@workspacejson/cli`, the four stable read paths, neutral producer conformance, private Vreko source, private Marcelle Labs swarm source, or workspace.json v0.5 design. Those live upstream in `workspacejson/*`.

This repository is **not** the proof corpus. It consumes the proof corpus (once selected by HAC-143) as an external, read-only input — it does not vendor or embed it.

## Ownership ruling

Recorded per [HAC-214](https://linear.app/marcelle-labs/issue/HAC-214):

```
REPOSITORY OWNER: workspacejson
REPOSITORY PATH:  workspacejson/datahub-agent
RATIONALE:        Public Apache-2.0 reference consumer of released workspace.json
                   interfaces. The application advances ecosystem adoption and
                   contains no private Marcelle Labs or Vreko implementation
                   dependency.
PROOF CORPUS:     HAC-143 (tracked separately, not part of this repository)
```

## Dependency boundary

- Consumes only **released, public** `@workspacejson/*` packages.
- No source-level cross-org imports. See [`docs/clean-room.md`](docs/clean-room.md).
- Must remain fully runnable **without** a Vreko daemon.
- DataHub-specific consumption of `workspacejson signals datahub` is gated behind [HAC-213](https://linear.app/marcelle-labs/issue/HAC-213)'s Path-B ruling. Until that ruling records `PATH B: IN`, this repository does not depend on that surface.

## Repository layout

```
docs/         clean-room import rule and other bounded documentation
examples/     runnable, judge-visible usage examples
evaluation/   held-out evaluation and baseline measurement (LOC, etc.)
```

## Local quickstart

See [`docs/quickstart.md`](docs/quickstart.md) for running a local DataHub instance and pointing this application at it.

## Status

This repository is being bootstrapped under [HAC-214](https://linear.app/marcelle-labs/issue/HAC-214). Related, not-yet-resolved decisions that gate future work here:

- [HAC-143](https://linear.app/marcelle-labs/issue/HAC-143) — proof corpus not yet selected/frozen.
- [HAC-213](https://linear.app/marcelle-labs/issue/HAC-213) — Path-B (`workspacejson signals datahub`) not yet ruled.
- [HAC-163](https://linear.app/marcelle-labs/issue/HAC-163) — agent substrate (build on the DataHub Analytics Agent/LangGraph vs. own) not yet decided; gates [HAC-148](https://linear.app/marcelle-labs/issue/HAC-148), [HAC-149](https://linear.app/marcelle-labs/issue/HAC-149), [HAC-152](https://linear.app/marcelle-labs/issue/HAC-152).

## License

Apache License 2.0 — see [`LICENSE`](LICENSE).
