#!/usr/bin/env node
/**
 * Emit a ChangeImpactEvent for one dataset, from a live DataHub plus the
 * workspace.json artifact.
 *
 * This is the read path the demo and the cockpit consume. It reads through the
 * catalog's GraphQL API — the same surface the official MCP server projects —
 * so the event reflects what an agent can actually obtain, not what a catalog
 * happens to store internally.
 *
 * Usage:
 *   node scripts/emit-change-impact-event.mjs [urn] [--gms URL] [--out FILE]
 *     --subject-repository URL --subject-revision SHA
 *     --workspace-artifact FILE
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const GMS = flag("gms", "http://localhost:8080");
const OUT = flag("out", null);
const SUBJECT_REPOSITORY = flag("subject-repository", null);
const SUBJECT_REVISION = flag("subject-revision", null);
const WORKSPACE_ARTIFACT = flag("workspace-artifact", null);
const READINESS_MANIFEST = flag("readiness-manifest", null);
const READINESS_DEADLINE_MS = Number(flag("readiness-deadline-ms", "120000"));
const URN = argv.find((a) => a.startsWith("urn:")) ?? null;
if (!URN) {
  console.error("usage: supply the DataHub dataset URN as the first positional argument");
  process.exit(2);
}

async function gql(query) {
  const response = await fetch(`${GMS}/api/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30_000),
  }).catch((e) => {
    console.error(`Cannot reach GMS at ${GMS} — ${e.message}`);
    process.exit(2);
  });
  const body = await response.json();
  if (body.errors) {
    console.error(`GraphQL error: ${JSON.stringify(body.errors).slice(0, 300)}`);
    process.exit(2);
  }
  return body.data;
}

const unavailable = [];
const note = (field, source, reason, detail, extra = {}) =>
  unavailable.push({ field, source, reason, detail, ...extra });

/**
 * A GraphQL read that reports failure to its caller instead of ending the
 * process. `gql` exits on error, which is right for the entity read the whole
 * event depends on and wrong for lineage: terminating there would lose the
 * event entirely, when the honest outcome is an event that says the lineage
 * query failed.
 */
async function gqlSafe(query) {
  try {
    const response = await fetch(`${GMS}/api/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, data: null, error: `HTTP ${response.status}: non-JSON response` };
    }
    if (body.errors) {
      return { ok: false, data: null, error: JSON.stringify(body.errors).slice(0, 200) };
    }
    if (!response.ok) return { ok: false, data: null, error: `HTTP ${response.status}` };
    return { ok: true, data: body.data, error: null };
  } catch (e) {
    return { ok: false, data: null, error: `${e.name}: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// DataHub context
// ---------------------------------------------------------------------------
const entity = await gql(`{
  dataset(urn: ${JSON.stringify(URN)}) {
    urn
    platform { name }
    properties { name description customProperties { key value } }
    ownership { owners { owner { ... on CorpUser { urn } ... on CorpGroup { urn } } } }
    domain { domain { urn } }
    schemaMetadata { fields { fieldPath } }
  }
}`);

if (!entity.dataset) {
  console.error(`No dataset at ${URN}`);
  process.exit(2);
}

const ds = entity.dataset;
const props = ds.properties ?? {};
const customProperties = Object.fromEntries(
  (props.customProperties ?? []).map((c) => [c.key, c.value]),
);

/** Query parameters the observation is only comparable under. */
const LINEAGE_QUERY = { surface: "searchAcrossLineage", query: "*", start: 0, count: 50 };

/**
 * Read one direction of lineage, and report its standing rather than only its
 * contents.
 *
 * `searchAcrossLineage` is search-backed, and the index converges after
 * ingestion — measured at several minutes for the nested corpus. So a result of
 * zero is not evidence the dataset has no edges, and a result of one is not
 * evidence it has one. Nothing available to a general read path can tell a
 * settled answer from a partial one, so this reports `unverified` and leaves
 * the claim to a caller holding an external expectation.
 *
 * A failed query is `read: "failed"` and never an empty result set. The
 * previous `.catch(() => null)` turned a transport or parse failure into zero
 * edges, which then became a positive claim that the catalog holds none —
 * the same collapse as index lag, with no convergence needed to trigger it.
 */
async function lineage(direction) {
  const { ok, data, error } = await gqlSafe(`{
    searchAcrossLineage(input: {
      urn: ${JSON.stringify(URN)}, direction: ${direction},
      query: ${JSON.stringify(LINEAGE_QUERY.query)}, start: ${LINEAGE_QUERY.start}, count: ${LINEAGE_QUERY.count}
    }) { total searchResults { degree entity { urn ... on Dataset { properties { name } } } } }
  }`);

  if (!ok) {
    return { edges: [], observation: { read: "failed", completeness: "unverified" }, error };
  }

  const results = data?.searchAcrossLineage?.searchResults ?? [];
  const edges = results.map((r) => ({
    urn: r.entity.urn,
    name: r.entity.properties?.name ?? null,
    degree: r.degree ?? 1,
  }));

  // `unverified` is not a hedge. It is the strongest claim the evidence
  // supports, and it stays unverified however many times the query is repeated:
  // repetition is not attestation.
  return {
    edges,
    observation: { read: "ok", completeness: "unverified", observedCount: edges.length },
    error: null,
  };
}

const up = await lineage("UPSTREAM");
const down = await lineage("DOWNSTREAM");
const upstreams = up.edges;
const downstreams = down.edges;

const lineageObservation = { upstreams: up.observation, downstreams: down.observation };

// A readiness manifest is optional evidence supplied by the corpus owner, not
// something this generic emitter invents. When present, it can upgrade exactly
// one direction only after two bounded, set-equal live reads.
if (READINESS_MANIFEST) {
  try {
    const manifest = JSON.parse(readFileSync(resolve(READINESS_MANIFEST), "utf8"));
    const direction = manifest?.queryParameters?.direction;
    if (direction !== "UPSTREAM" && direction !== "DOWNSTREAM") throw new Error("queryParameters.direction must be UPSTREAM or DOWNSTREAM");
    const { observeReadiness } = await import(join(repoRoot, "src/integration/readiness.ts")).catch(async () => import("tsx/esm/api").then(async (api) => {
      api.register(); return import(join(repoRoot, "src/integration/readiness.ts"));
    }));
    const readiness = await observeReadiness(manifest, READINESS_DEADLINE_MS, async (signal) => {
      const response = await fetch(`${GMS}/api/graphql`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal,
        body: JSON.stringify({ query: `{ searchAcrossLineage(input: { urn: ${JSON.stringify(URN)}, direction: ${direction}, query: ${JSON.stringify(LINEAGE_QUERY.query)}, start: ${LINEAGE_QUERY.start}, count: ${LINEAGE_QUERY.count} }) { searchResults { entity { urn } } } }` }),
      });
      const body = await response.json();
      if (!response.ok || body.errors) throw new Error("readiness GraphQL request failed");
      return (body.data?.searchAcrossLineage?.searchResults ?? []).map((result) => result.entity.urn);
    });
    if (readiness.disposition === "ready") {
      const key = direction === "UPSTREAM" ? "upstreams" : "downstreams";
      const observed = (key === "upstreams" ? upstreams : downstreams).map((edge) => edge.urn).sort();
      const expected = [...new Set(manifest.expectedUrns)].sort();
      if (JSON.stringify(observed) === JSON.stringify(expected)) {
        lineageObservation[key] = { read: "ok", completeness: "verified", observedCount: observed.length, verification: {
          manifestDigest: readiness.manifestDigest, expectedSetDigest: readiness.expectedSetDigest,
          observedSetDigest: readiness.observedSetDigest, queryParameters: manifest.queryParameters,
        } };
      } else {
        note(`datahub.${key}`, "datahub", "indeterminate", "Readiness polls settled, but the event lineage read differed from the declared expected set; completeness was not upgraded.", { completeness: "unverified", observedCount: observed.length });
      }
    }
  } catch (error) {
    note("datahub.readiness", "datahub", "failed", `Readiness manifest was not usable: ${error.message}`);
  }
}

for (const [field, side] of [
  ["datahub.upstreams", up],
  ["datahub.downstreams", down],
]) {
  const kind = field.endsWith("upstreams") ? "upstream" : "downstream";
  if (side.observation.read === "failed") {
    note(field, "datahub", "failed",
      `The ${kind} lineage query did not complete (${side.error}). This is not a statement about the catalog's contents.`);
  } else if (side.edges.length === 0) {
    // Deliberately not `absent`. The query succeeded and returned nothing;
    // whether that nothing is the whole answer is exactly what is unknown.
    note(field, "datahub", "indeterminate",
      `The catalog returned no ${kind} edges. The lineage index converges after ingestion, so this is not evidence that none exist.`,
      { completeness: "unverified", observedCount: 0 });
  }
}

// ---------------------------------------------------------------------------
// Code resolution
// ---------------------------------------------------------------------------
const dbtFilePath = customProperties.dbt_file_path ?? null;
// `externalUrl`, repository and commit are direct GraphQL fields, not part of
// the official DataHub MCP projection. Do not smuggle them into this event.
const sourceUrl = null;

let repositoryRelativePath = null;
let projectPrefix = null;
let method = "unresolved";

if (dbtFilePath) note("code.repositoryRelativePath", "datahub", "not-exposed-by-source",
  "The official DataHub MCP projection exposes the dbt model path but not repository, revision, or project prefix. Exact resolution requires a corpus-matched workspace artifact.");

// ---------------------------------------------------------------------------
// workspace.json evidence
// ---------------------------------------------------------------------------
const { assessWorkspaceEvidence } = await import(join(repoRoot, "src/integration/workspace-evidence.ts")).catch(async () => import("tsx/esm/api").then(async (api) => {
  api.register();
  return import(join(repoRoot, "src/integration/workspace-evidence.ts"));
}));
let workspaceArtifact = null;
let partners = [];
const records = [];
let ws = null;
let artifactIdentity = null;
if (WORKSPACE_ARTIFACT) {
  try {
    const artifactPath = resolve(WORKSPACE_ARTIFACT);
    ws = JSON.parse(readFileSync(artifactPath, "utf8"));
    const sidecarPath = join(dirname(artifactPath), "workspace-provenance.json");
    if (!existsSync(sidecarPath)) {
      note("partners", "workspacejson", "failed", "The supplied workspace.json has no provenance sidecar; artifact identity cannot be verified.");
    } else {
      const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8"));
      artifactIdentity = { repository: sidecar.corpus ?? null, revision: sidecar.commit ?? null };
    }
  } catch { note("partners", "workspacejson", "failed", "The supplied workspace.json artifact or provenance sidecar could not be parsed."); }
}
const integrity = assessWorkspaceEvidence(
  { repository: SUBJECT_REPOSITORY, revision: SUBJECT_REVISION },
  ws && artifactIdentity ? artifactIdentity : null,
  ws?.generated?.fileIndex ?? null,
  dbtFilePath,
);
workspaceArtifact = {
  producedBy: ws?.generated?.by?.name ?? null, fileIndexKeys: integrity.fileIndexKeys,
  repository: artifactIdentity?.repository ?? null, revision: artifactIdentity?.revision ?? null, integrity: integrity.integrity,
};
if (integrity.integrity === "exact-match") {
  repositoryRelativePath = integrity.repositoryRelativePath;
  projectPrefix = repositoryRelativePath.slice(0, repositoryRelativePath.length - dbtFilePath.length).replace(/\/$/, "");
  method = "manifest-join";
  records.push({ claim: `producing file ${repositoryRelativePath} is tracked in the corpus-matched workspace.json artifact`, observation: integrity.detail, source: "workspacejson", verified: true });
  note("partners", "workspacejson", "indeterminate", "The artifact resolves the exact source but contains no behavioral co-change evidence, so no partners are asserted.", { completeness: "unverified", observedCount: 0 });
} else if (!unavailable.some((u) => u.field === "partners")) {
  // A refusal never observed an empty collection. Keep its count absent.
  note("partners", "workspacejson", integrity.integrity === "artifact-unavailable" ? "not-queried" : "indeterminate", integrity.detail);
}

// ---------------------------------------------------------------------------
const { deriveTier, validateEvent, CHANGE_IMPACT_EVENT_VERSION } = await import(
  join(repoRoot, "src/integration/change-impact-event.ts")
).catch(async () => import("tsx/esm/api").then(async (api) => {
  api.register();
  return import(join(repoRoot, "src/integration/change-impact-event.ts"));
}));

const gmsVersionData = await gql("{ appConfig { appVersion } }").catch(() => null);

const event = {
  eventVersion: CHANGE_IMPACT_EVENT_VERSION,
  provenance: {
    producedAt: new Date().toISOString(),
    producer: { name: "@workspacejson/datahub-agent", version: "0.0.1" },
    datahub: { gmsUrl: GMS, gmsVersion: gmsVersionData?.appConfig?.appVersion ?? null },
    corpus: { repository: SUBJECT_REPOSITORY, commit: SUBJECT_REVISION },
    workspaceArtifact,
  },
  subject: { urn: URN },
  datahub: {
    name: props.name ?? null,
    platform: ds.platform?.name ?? null,
    description: props.description ?? null,
    upstreams,
    downstreams,
    lineageObservation,
    schemaFieldCount: ds.schemaMetadata?.fields?.length ?? null,
    owners: (ds.ownership?.owners ?? []).map((o) => o.owner?.urn).filter(Boolean),
    domain: ds.domain?.domain?.urn ?? null,
  },
  code: {
    dbtUniqueId: customProperties.dbt_unique_id ?? null,
    dbtFilePath,
    repositoryRelativePath,
    projectPrefix,
    method,
    sourceUrl,
  },
  partners,
  evidence: { records, tier: deriveTier(records) },
  accounting: {
    datasetsRequested: 1,
    datasetsResolved: method === "unresolved" ? 0 : 1,
    datasetsUnresolved: method === "unresolved" ? 1 : 0,
    nodesDropped: 0,
    nodesExcluded: {},
  },
  unavailable,
};

const problems = validateEvent(event);
const json = `${JSON.stringify(event, null, 2)}\n`;

if (OUT) {
  writeFileSync(resolve(OUT), json);
  console.log(`written to ${OUT}`);
} else {
  console.log(json);
}

console.error(`\nsubject      ${URN}`);
console.error(`resolution   ${method}  ->  ${repositoryRelativePath ?? "(unresolved)"}`);
console.error(`prefix       ${projectPrefix === "" ? "(repository root)" : projectPrefix ?? "(unknown)"}`);
console.error(`lineage      ${upstreams.length} up / ${downstreams.length} down`);
console.error(`evidence     ${event.evidence.tier} (${records.length} record(s))`);
console.error(`unavailable  ${unavailable.length} stated`);
console.error(problems.length ? `INVALID:\n  ${problems.join("\n  ")}` : "contract   valid");
process.exit(problems.length ? 1 : 0);
