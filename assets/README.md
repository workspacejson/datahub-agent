# Tally asset registry

`assets/manifest.json` is the candidate source registry for checked-in Tally
visual assets. It records paths and hashes; it is **not** a website source lock.
A website consumer pins the final commit that contains this registry after owner
review. The registry cannot contain that commit SHA because doing so would be an
impossible self-reference.

## Scope and states

The inventory scans checked-in files under `public/assets/`. Browser-test output
and generated reports are excluded. Supporting fixtures and checksum manifests
are recorded separately as evidence; they are not display assets and cannot
authorize public use.

Every discovered display asset begins as both `approvalState: "pending"` and
`publicUse: "pending"`. A repository path, public repository, recent commit, or
proposed caption does not change either state.

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
