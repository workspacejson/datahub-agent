# Security posture

This document states what is enforced, what is bounded, and what is explicitly
not claimed. Every statement here points to executable enforcement or a stated
limitation.

## Reporting

Report security issues through [GitHub Issues](https://github.com/workspacejson/datahub-agent/issues).
This is a hackathon reference repository, not a production service — there is no
private disclosure channel or SLA.

## Credential handling

No credentials are stored in any committed artifact. The live evidence package
(`evaluation/hac-152/`) explicitly redacts secret values and never stores them.
The golden fixtures' writeback blocks are scanned for `token`, `password`,
`secret`, and `authorization` fields — a credential that is not explicitly
redacted fails the test.

**Enforced by:** `test/integration/golden-fixture.test.ts` — "carries no
credential, since the fixture is committed."

**Artifact scope:** The golden fixtures' writeback blocks
(`test/fixtures/golden/change-impact-event.root.json` and
`change-impact-event.nested.json`). This is not a comprehensive secret scan of
every committed file.

## Clean-room rule

This repository consumes only released, published `@workspacejson/*` packages
from the public npm registry. No source-level imports from private checkouts,
sibling repositories, or git submodules. See [`docs/clean-room.md`](docs/clean-room.md).

**Enforced by:** `npm run check:clean-room` — verifies every dependency resolves
to a published version, no path references, no local links in the lockfile.

## Two-field write boundary

Tally writes exactly two things to DataHub and nothing else:

1. A labelled link from the dataset to the producing file, pinned to an
   immutable commit (`upsertLink`).
2. An evidence-tier structured property (`upsertStructuredProperties`).

Deliberately not written: risk scores, descriptions, editable properties, or
anything under a `manual.*` path.

**Enforced by:** `test/integration/golden-fixture.test.ts` — "wrote nothing
human-authored, as recorded in the attempts themselves."

## Metadata and PII

No user personal information is collected, stored, or transmitted by this
repository. The repository contains repository metadata (commit SHAs, file
paths, dataset URNs) and DataHub catalog metadata (lineage, schema, ownership).
No redaction pipeline is applied because no PII enters the artifacts.

## Explicit non-claims

- **No comprehensive secret scanning.** The credential scan covers the golden
  fixtures' writeback blocks only, not every committed file.
- **No safety certification.** This repository has not undergone a security
  audit.
- **No production readiness.** This is a hackathon reference repository, not a
  production deployment.
- **No authentication or authorization layer.** The repository is a public
  reference implementation. DataHub credentials required for live runs are
  managed by the operator, not by this repository.
