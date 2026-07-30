# Tally asset registry

`assets/manifest.json` is the candidate source registry for checked-in Tally
visual assets. It records paths and hashes; it is **not** a website source lock.
A website consumer pins the final commit that contains this registry after owner
review. The registry cannot contain that commit SHA because doing so would be an
impossible self-reference.

## Scope and states

The inventory scans checked-in files under `public/assets/` and
`apps/cockpit/public/`, including their subdirectories: `devpost/`, `github/` and
`social/`. Browser-test output and generated reports are excluded. Supporting
fixtures and checksum manifests are recorded separately as evidence; they are not
display assets and cannot authorize public use.

Every discovered display asset begins as both `approvalState: "pending"` and
`publicUse: "pending"`. A repository path, public repository, recent commit, or
proposed caption does not change either state.

`inventoryScope.scannedAtBaseRevision` names the revision the original scan ran
against. Records added after that scan were entered by hand under owner
direction rather than discovered, so the field is deliberately not advanced: it
describes when a scan happened, not when the registry was last edited.

An `approvalRecord` field appears on any record whose `approvalState` is
`approved`, naming who authorized it, when, and for which destination. An
approval with no such record is unattributed and should be treated as suspect.

## What this registry cannot tell you

`npm run validate:asset-registry` walks the records and checks each declared file
against its hash. **It never enumerates the filesystem, so it cannot report a
checked-in asset that no record declares.** Eight images were added under
`assets/` on 2026-07-29 and the gate stayed green throughout, because an
undeclared file is invisible to a validator that only reads declarations.

Until that is closed, adding an asset means adding its record in the same change.
A green registry validation is evidence that the declared assets are intact, not
evidence that every checked-in asset is declared.

Allowed `approvalState` values are:

- `pending`
- `approved`
- `rejected`
- `superseded`

Allowed `publicUse` values are:

- `pending`
- `allowed`
- `prohibited`

`proposedAltText` and `proposedCaption` are review inputs, never approvals.
Any record with proposed language remains pending until the owner explicitly
approves both its asset and destination use.

## Claim IDs

Asset `claimIds` reference stable identifiers in
[`docs/claim-ids.json`](../docs/claim-ids.json). An empty list means no claim
relationship has been approved; it does not mean the image is evidence-free or
safe to publish.

## Validate

Run the bounded registry validation without downloading or generating assets:

```bash
npm run validate:asset-registry
```

It verifies unique asset and claim IDs, referenced claims, repository paths,
byte hashes, controlled approval/public-use states, public-asset accessibility
metadata, and evidence metadata for approved quantitative assets.
