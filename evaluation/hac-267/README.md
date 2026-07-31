# HAC-267: Unresolved repository mismatch fixture

> **Type:** Evidence | **Status:** Current | **Scope:** UnresolvedRecords capture

## What this is

A captured `ChangeImpactEvent` where the join reports `unresolvedRecords`
because the dataset URN (`jaffle_shop.main.customers`) is genuinely present
in the live catalog but the workspace artifact supplied is the Transfermarkt
one. The mismatch is real, not simulated.

## Files

- `unresolved-repository-mismatch.json` — the captured event
- `unresolved-repository-mismatch.provenance.json` — capture provenance
  (transport, corpus, why the residual is real)

## How to verify

Read the JSON and confirm:

1. `accounting.unresolvedRecords` is non-empty
2. The unresolved record names the URN that was requested
3. The provenance file records the transport and corpus pin

## Why this exists

The demo corpus resolves 23/23 with no residual. To evidence the
`unresolvedRecords` field without fabrication, a request was made that
legitimately falls outside the artifact — a real dataset against the wrong
workspace artifact.
