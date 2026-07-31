import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

const root = process.cwd();
const manifestPath = resolve(root, "assets/manifest.json");
const claimsPath = resolve(root, "docs/claim-ids.json");
const approvalStates = new Set(["pending", "approved", "rejected", "superseded"]);
const publicUseStates = new Set(["pending", "allowed", "prohibited"]);
const errors = [];

function fail(message) {
  errors.push(message);
}

function requireString(record, field, label) {
  if (typeof record[field] !== "string" || record[field].trim() === "") {
    fail(`${label} is missing ${field}`);
  }
}

function uniqueIds(records, label) {
  const ids = new Set();
  for (const record of records) {
    if (typeof record.id !== "string" || record.id.trim() === "") {
      fail(`${label} has a record without an id`);
      continue;
    }
    if (ids.has(record.id)) fail(`duplicate ${label} id: ${record.id}`);
    ids.add(record.id);
  }
  return ids;
}

if (!existsSync(manifestPath)) fail("assets/manifest.json does not exist");
if (!existsSync(claimsPath)) fail("docs/claim-ids.json does not exist");

if (errors.length === 0) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const claimLedger = JSON.parse(readFileSync(claimsPath, "utf8"));
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const claims = Array.isArray(claimLedger.claims) ? claimLedger.claims : [];
  const assetIds = uniqueIds(assets, "asset");
  const claimIds = uniqueIds(claims, "claim");

  for (const asset of assets) {
    const label = `asset ${asset.id ?? "<unknown>"}`;
    for (const field of [
      "title",
      "storyBeat",
      "intendedConclusion",
      "canonicalPath",
      "sha256",
      "sourceType",
      "proposedAltText",
      "proposedCaption",
      "stalenessRule"
    ]) requireString(asset, field, label);

    if (!approvalStates.has(asset.approvalState)) {
      fail(`${label} has invalid or missing approvalState`);
    }
    if (!publicUseStates.has(asset.publicUse)) {
      fail(`${label} has invalid or missing publicUse`);
    }
    if (!Array.isArray(asset.claimIds)) {
      fail(`${label} has missing claimIds`);
    } else {
      for (const claimId of asset.claimIds) {
        if (!claimIds.has(claimId)) fail(`${label} references missing claim ID: ${claimId}`);
      }
    }

    if (typeof asset.canonicalPath === "string") {
      const assetPath = resolve(root, asset.canonicalPath);
      if (!assetPath.startsWith(`${root}${sep}`)) {
        fail(`${label} path leaves the repository: ${asset.canonicalPath}`);
      } else if (!existsSync(assetPath) || !statSync(assetPath).isFile()) {
        fail(`${label} references nonexistent asset path: ${asset.canonicalPath}`);
      } else {
        const actualHash = createHash("sha256").update(readFileSync(assetPath)).digest("hex");
        if (actualHash !== asset.sha256) fail(`${label} SHA-256 mismatch`);
      }
    }

    if (!asset.export || typeof asset.export !== "object") fail(`${label} is missing export metadata`);
    if (!Array.isArray(asset.limitations) || asset.limitations.length === 0) {
      fail(`${label} is missing limitations`);
      continue;
    }
    if (!asset.destinationEligibility || typeof asset.destinationEligibility !== "object") {
      fail(`${label} is missing destination eligibility`);
    }

    const approvedPublic = asset.approvalState === "approved" && asset.publicUse === "allowed";
    if (approvedPublic && (!asset.proposedAltText?.trim() || !asset.proposedCaption?.trim())) {
      fail(`${label} is approved for public use without caption or alt text`);
    }
    if (asset.approvalState === "approved" && asset.publicUse !== "allowed") {
      fail(`${label} is approved but publicUse is not allowed`);
    }
    if (asset.approvalState === "approved" && asset.isQuantitative === true && !asset.productEvidenceRevision?.evidenceRevision) {
      fail(`${label} is an approved quantitative asset without evidence revision`);
    }
  }

  if (assetIds.size !== assets.length || claimIds.size !== claims.length) {
    // Individual duplicate errors above are more useful; this makes the failure condition explicit.
    fail("registry contains duplicate asset or claim IDs");
  }
}

if (errors.length > 0) {
  console.error("Asset registry validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Asset registry validation passed.");
}
