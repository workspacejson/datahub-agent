# Tally asset registry

`assets/manifest.json` is the candidate source registry for checked-in Tally
visual assets. It records paths and hashes; it is **not** a website source lock.
A website consumer pins the final commit that contains this registry after owner
review. The registry cannot contain that commit SHA because doing so would be an
impossible self-reference.

## Scope and states

## Layout

The structure is the one HAC-277 specifies:

```text
assets/
  manifest.json              the machine-readable registry
  README.md                  this file
  source/                    editable open formats that belong in git
  exports/<asset-id>/        approved destination exports, one directory per record
```

`exports/<asset-id>/` is one directory per registry record, so a record and its
file cannot drift apart by filename. Exports lived under `public/assets/` until
2026-07-29; that directory is gone, because two homes for one asset is the state
this registry exists to prevent.

`source/` is currently unpopulated, and that is a real gap rather than a tidy
default: none of the checked-in exports has an editable source in this
repository, so none of them can be regenerated from a clean clone. Each record
says so in its `editableSource` and its limitations.

The brand vectors stay at `apps/cockpit/public/brand/`. The running application
serves them from there, so that path is their single canonical home; copying them
into `source/` would create the second home the acceptance criteria forbid.

The inventory scans `assets/exports/` and `apps/cockpit/public/`. Browser-test
output and generated reports are excluded. Supporting fixtures and checksum
manifests are recorded separately as evidence; they are not display assets and
cannot authorize public use.

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

## Per-record fields, and which are honestly empty

Every record carries the fields HAC-277 requires. Several are deliberately null,
and a null here is a statement rather than an omission:

| Field | Note |
| -- | -- |
| `owner` | The person accountable for the asset, not its author. |
| `destinationSurface` | The single surface the asset is for. `destinationEligibility` is the per-destination approval grid and is a different question. |
| `export.colorMode` | Read from the file, not assumed. Includes whether a colour profile is embedded; none of the current PNGs carries one, so consumers will assume sRGB. |
| `export.safeArea` | **Null on every record.** No crop specification was supplied for any export. Null means unspecified, not "the full frame is safe". |
| `editableSource` | `none-in-repository` for every raster: the export is governed, its origin is not, and re-export needs a tool outside version control. |
| `generatedAt` | Filesystem mtime at registration, with `source` saying so. No export event was ever recorded, so this is when the file was last written, not provably when it was produced. |
| `refreshTrigger` | Measured assets refresh when a displayed value changes; brand assets when the mark, palette or copy changes. |
| `publicDestination` | `url` and `uploadReceipt` are null everywhere, and `verifiedLoggedOut` is false everywhere. **No destination has been verified logged out**, which HAC-277 requires before a destination counts as published. |
| `supersedes` | Populated on the two GitHub heroes, which replace `tally-github-readme`. |

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
