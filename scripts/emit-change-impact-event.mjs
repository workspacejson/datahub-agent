#!/usr/bin/env node
/**
 * Emit a ChangeImpactEvent for one dataset, from a live DataHub plus the
 * workspace.json artifact.
 *
 * This is the read path the demo and the cockpit consume.
 *
 * ## Transport
 *
 * By default this reads through the **official DataHub MCP server**
 * (`acryldata/mcp-server-datahub`), spawned over stdio and called with its own
 * `get_entities`, `get_lineage` and `list_schema_fields` tools. That is the
 * transport, not a resemblance to one.
 *
 * It previously read DataHub's GraphQL API directly while restricting itself to
 * the fields the MCP server projects, and described the result as MCP-faithful.
 * The restriction was real and measured, and it still was not MCP. "We ask for
 * the same fields the MCP server would" is a claim about a request body; "we
 * read through the official MCP server" is a claim about transport. This
 * repository asserted the second and implemented the first.
 *
 * The difference is not pedantic. A self-imposed projection is enforced by
 * whoever last edited the query string — add a field and nothing fails. Reading
 * through the server makes the boundary structural: a field the projection drops
 * cannot be asked for, because the process on the other end never sends it. That
 * has already been the failure mode here once, when this script read
 * `externalUrl` while claiming to sit behind a boundary that drops it.
 *
 * `--transport gms` keeps the direct GraphQL path, and is honest about being
 * exactly that. It exists because the two reads are worth comparing — running
 * both against one instance is what shows the MCP boundary costing something
 * specific rather than being asserted to.
 *
 * The cost is real under either flag and is stated rather than worked around:
 * the MCP `Dataset` projection carries no `externalUrl`, so `code.sourceUrl` is
 * null, no `external-url` resolution is possible, and the writeback states a
 * scoped link omission. HAC-156 is the upstream fix, and
 * `evaluation/mcp-field-coverage.md` holds the measurement.
 *
 * Usage:
 *   node scripts/emit-change-impact-event.mjs [urn] [--gms URL] [--out FILE]
 *     [--transport mcp|gms] [--mcp-command BIN]
 *     --subject-repository URL --subject-revision SHA
 *     --workspace-artifact FILE
 */

import { readFileSync, writeFileSync } from "node:fs";
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
const TRANSPORT = flag("transport", "mcp");
const MCP_COMMAND = flag("mcp-command", "mcp-server-datahub");
if (TRANSPORT !== "mcp" && TRANSPORT !== "gms") {
  console.error(`--transport must be "mcp" or "gms"; got ${JSON.stringify(TRANSPORT)}`);
  process.exit(2);
}
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
//
// Two transports, one shape. Everything below this block reads the same
// variables whichever flag was passed, so the difference between transports
// stays in one place instead of branching through the whole emitter.
// ---------------------------------------------------------------------------

const load = async (specifier) =>
  import(join(repoRoot, specifier)).catch(async () =>
    import("tsx/esm/api").then(async (api) => {
      api.register();
      return import(join(repoRoot, specifier));
    }),
  );

/**
 * The parameters the read this emitter is about to perform will carry.
 *
 * The MCP arm is imported rather than restated. `LINEAGE_QUERY_PARAMETERS` was
 * exported and documented for exactly this — "the parameters a lineage
 * observation is only comparable under" — and nothing read it, while a
 * hand-copy of the same four values sat here. A constant with no consumer does
 * not look like dead code; it looks like the thing being used, which is how
 * this stayed wrong.
 *
 * `direction` is not here because it is per-read, and is added at the point the
 * read is made.
 */
const { LINEAGE_QUERY_PARAMETERS } = await load("src/integration/mcp-read.ts");
const LINEAGE_QUERY =
  TRANSPORT === "mcp"
    ? { ...LINEAGE_QUERY_PARAMETERS }
    : { surface: "searchAcrossLineage", query: "*", start: 0, count: 50 };

/** Which transport actually issued the read, in the contract's vocabulary. */
const EXECUTED_TRANSPORT = TRANSPORT === "mcp" ? "mcp" : "gms";

let dataset;
let schemaFieldCount = null;
let gmsVersion = null;
let mcpServer = null;
let mcpClient = null;
/** Reads one direction of lineage under whichever transport is selected. */
let lineage;

if (TRANSPORT === "mcp") {
  const { McpClient } = await load("src/integration/mcp-transport.ts");
  const mcpRead = await load("src/integration/mcp-read.ts");

  mcpClient = new McpClient(
    {
      command: MCP_COMMAND,
      args: ["--transport", "stdio"],
      env: {
        DATAHUB_GMS_URL: GMS,
        // The server blocks its own startup on an outbound telemetry POST, and
        // a judge on a restricted network would otherwise watch the handshake
        // spend forty seconds in connect-retry before answering.
        DATAHUB_TELEMETRY_ENABLED: "false",
      },
    },
    { requestTimeoutMs: 90_000 },
  );

  try {
    mcpServer = await mcpClient.start();
  } catch (error) {
    console.error(`Could not start the DataHub MCP server (${MCP_COMMAND}): ${error.message}`);
    console.error(`Install it with: pip install mcp-server-datahub`);
    console.error(mcpClient.stderr.slice(0, 800));
    process.exit(2);
  }

  // A missing tool is a property of the server version, not of this dataset.
  // Finding out three calls in would produce an event that is partly a
  // measurement and partly a version complaint, with no way to tell which
  // fields are which.
  const advertised = (await mcpClient.listTools()).map((tool) => tool.name);
  const missing = mcpRead.missingTools(advertised);
  if (missing.length) {
    console.error(`The MCP server at ${MCP_COMMAND} does not advertise: ${missing.join(", ")}`);
    console.error(`It advertises: ${advertised.join(", ")}`);
    await mcpClient.stop();
    process.exit(2);
  }

  const call = (name, args) => mcpClient.callTool(name, args);

  dataset = await mcpRead.readDataset(call, URN);
  if (dataset.read !== "ok") {
    console.error(`No readable dataset at ${URN} over MCP: ${dataset.error}`);
    await mcpClient.stop();
    process.exit(2);
  }

  const schema = await mcpRead.readSchemaFieldCount(call, URN);
  if (schema.read === "ok") {
    schemaFieldCount = schema.totalFields;
  } else {
    note("datahub.schemaFieldCount", "datahub", "failed",
      `The schema field count could not be read (${schema.error}). This is not a statement about the dataset's schema.`);
  }

  // The MCP surface exposes no tool reporting the server's own version. Left
  // null and stated, rather than reached for over a second transport — an event
  // that says it was produced over MCP should not carry a field only a direct
  // GraphQL call could have supplied.
  note("provenance.datahub.gmsVersion", "datahub", "not-exposed-by-source",
    "The official DataHub MCP server exposes no tool reporting the GMS version, and this event was produced over MCP. The MCP server's own name and version are recorded on stderr.");

  lineage = async (direction) => {
    const read = await mcpRead.readLineage(call, URN, direction === "UPSTREAM");
    if (read.read !== "ok") {
      return { edges: [], observation: { read: "failed", completeness: "not-established" }, error: read.error };
    }
    return {
      edges: read.edges,
      observation: { read: "ok", completeness: "not-established", observedCount: read.edges.length },
      error: null,
    };
  };
} else {
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
  dataset = {
    name: props.name ?? null,
    platform: ds.platform?.name ?? null,
    description: props.description ?? null,
    // `externalUrl`, repository and commit are direct GraphQL fields that the
    // official MCP projection drops. They are not requested even here, so the
    // two transports differ in how the boundary is enforced and not in what
    // this event ends up carrying.
    customProperties: Object.fromEntries((props.customProperties ?? []).map((c) => [c.key, c.value])),
    owners: (ds.ownership?.owners ?? []).map((o) => o.owner?.urn).filter(Boolean),
    domain: ds.domain?.domain?.urn ?? null,
  };
  schemaFieldCount = ds.schemaMetadata?.fields?.length ?? null;

  const gmsVersionData = await gql("{ appConfig { appVersion } }").catch(() => null);
  gmsVersion = gmsVersionData?.appConfig?.appVersion ?? null;

  lineage = lineageOverGraphQl;
}

const customProperties = dataset.customProperties;

/**
 * Read one direction of lineage, and report its standing rather than only its
 * contents.
 *
 * `searchAcrossLineage` is search-backed, and the index converges after
 * ingestion — measured at several minutes for the nested corpus. So a result of
 * zero is not evidence the dataset has no edges, and a result of one is not
 * evidence it has one. Nothing available to a general read path can tell a
 * settled answer from a partial one, so this reports `not-established` and leaves
 * the claim to a caller holding an external expectation.
 *
 * A failed query is `read: "failed"` and never an empty result set. The
 * previous `.catch(() => null)` turned a transport or parse failure into zero
 * edges, which then became a positive claim that the catalog holds none —
 * the same collapse as index lag, with no convergence needed to trigger it.
 *
 * This is the `--transport gms` reader. The MCP reader is assembled above and
 * reports the same shape; both are reached through `lineage`.
 */
async function lineageOverGraphQl(direction) {
  const { ok, data, error } = await gqlSafe(`{
    searchAcrossLineage(input: {
      urn: ${JSON.stringify(URN)}, direction: ${direction},
      query: ${JSON.stringify(LINEAGE_QUERY.query)}, start: ${LINEAGE_QUERY.start}, count: ${LINEAGE_QUERY.count}
    }) { total searchResults { degree entity { urn ... on Dataset { properties { name } } } } }
  }`);

  if (!ok) {
    return { edges: [], observation: { read: "failed", completeness: "not-established" }, error };
  }

  const results = data?.searchAcrossLineage?.searchResults ?? [];
  const edges = results.map((r) => ({
    urn: r.entity.urn,
    name: r.entity.properties?.name ?? null,
    degree: r.degree ?? 1,
  }));

  // `not-established` is not a hedge. It is the strongest claim the evidence
  // supports, and it stays not-established however many times the query is repeated:
  // repetition is not attestation.
  return {
    edges,
    observation: { read: "ok", completeness: "not-established", observedCount: edges.length },
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
    const { observeReadiness } = await load("src/integration/readiness.ts");

    // The readiness poll must use the same transport as the event's own lineage
    // read. Polling over GraphQL and then upgrading an MCP-read observation
    // would attest to a set the event did not obtain — two surfaces with
    // different hop semantics, one of them silently standing in for the other.
    const pollUrns =
      TRANSPORT === "mcp"
        ? async () => {
            const read = await lineage(direction);
            if (read.observation.read !== "ok") throw new Error(read.error ?? "readiness MCP read failed");
            return read.edges.map((edge) => edge.urn);
          }
        : async (signal) => {
            const response = await fetch(`${GMS}/api/graphql`, {
              method: "POST", headers: { "Content-Type": "application/json" }, signal,
              body: JSON.stringify({ query: `{ searchAcrossLineage(input: { urn: ${JSON.stringify(URN)}, direction: ${direction}, query: ${JSON.stringify(LINEAGE_QUERY.query)}, start: ${LINEAGE_QUERY.start}, count: ${LINEAGE_QUERY.count} }) { searchResults { entity { urn } } } }` }),
            });
            const body = await response.json();
            if (!response.ok || body.errors) throw new Error("readiness GraphQL request failed");
            return (body.data?.searchAcrossLineage?.searchResults ?? []).map((result) => result.entity.urn);
          };

    const readiness = await observeReadiness(manifest, READINESS_DEADLINE_MS, pollUrns);
    if (readiness.disposition === "ready") {
      const key = direction === "UPSTREAM" ? "upstreams" : "downstreams";
      const observed = (key === "upstreams" ? upstreams : downstreams).map((edge) => edge.urn).sort();
      const expected = [...new Set(manifest.expectedUrns)].sort();
      if (JSON.stringify(observed) === JSON.stringify(expected)) {
        // Two parameter sets, because they describe two different requests.
        //
        // `declaredQueryParameters` is the manifest's own — how the expected
        // set was derived. `executedRead` is this run's, and it is what
        // produced `observedSetDigest`. Recording the manifest's under a name
        // that reads as the observation's is the defect this replaces: under
        // `--transport mcp` the observed set came from `mcp:get_lineage` at
        // three hops while the recorded parameters described
        // `searchAcrossLineage` at `maxDegree: 4`, so an auditor rerunning them
        // ran a query this event never ran.
        //
        // `direction` is added here rather than carried on LINEAGE_QUERY,
        // because it is a property of the individual read and the contract's
        // direction invariant reads it from exactly this place.
        lineageObservation[key] = { read: "ok", completeness: "complete-against-pinned-manifest", observedCount: observed.length, verification: {
          manifestDigest: readiness.manifestDigest, expectedSetDigest: readiness.expectedSetDigest,
          observedSetDigest: readiness.observedSetDigest,
          declaredQueryParameters: manifest.queryParameters,
          executedRead: {
            transport: EXECUTED_TRANSPORT,
            surface: LINEAGE_QUERY.surface,
            parameters: { ...LINEAGE_QUERY, direction },
          },
        } };
      } else {
        note(`datahub.${key}`, "datahub", "indeterminate", "Readiness polls settled, but the event lineage read differed from the declared expected set; completeness was not upgraded.", { completeness: "not-established", observedCount: observed.length });
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
      { completeness: "not-established", observedCount: 0 });
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
const { assessWorkspaceEvidence, readArtifactIdentity } = await load(
  "src/integration/workspace-evidence.ts",
);
const { unresolvedRecordsFor } = await load("src/integration/unresolved-records.ts");
let workspaceArtifact = null;
const partners = [];
const records = [];
let ws = null;
let artifactIdentity = null;
if (WORKSPACE_ARTIFACT) {
  const artifactPath = resolve(WORKSPACE_ARTIFACT);
  let artifactBytes = null;
  try {
    artifactBytes = readFileSync(artifactPath);
    ws = JSON.parse(artifactBytes.toString("utf8"));
  } catch (e) {
    note("partners", "workspacejson", "failed",
      `The supplied workspace.json artifact could not be read (${e.message}).`);
  }
  if (ws) {
    // Identity comes from the sidecar, and the sidecar must be bound to these
    // exact bytes. An unbound sidecar can drift — provenance saying commit X
    // while the artifact was regenerated at commit Y — which is the same defect
    // class as the cross-corpus join it exists to prevent.
    //
    // The bytes just parsed are handed over rather than re-read, so the digest
    // is computed over what this event was actually built from.
    const identity = readArtifactIdentity(artifactPath, artifactBytes);
    if (identity.status === "found") {
      artifactIdentity = { repository: identity.repository, revision: identity.revision };
    } else {
      // `identity.detail` names the sidecar status in prose. Deliberately not
      // attached as a structured field: `Unavailable` does not declare one, and
      // this script is untyped, so an extra key would ship into the event with
      // nothing to catch it — a field no consumer is documented to expect.
      note("partners", "workspacejson", "failed", identity.detail);
    }
  }
}
const integrity = assessWorkspaceEvidence(
  { repository: SUBJECT_REPOSITORY, revision: SUBJECT_REVISION },
  ws && artifactIdentity ? artifactIdentity : null,
  ws?.generated?.fileIndex ?? null,
  dbtFilePath,
);
workspaceArtifact = {
  // `producedBy` is reported only alongside an established identity.
  //
  // Reading it straight from the artifact meant an event could name the producer
  // of a file whose identity was refused — `producedBy: "@workspacejson/cli"`
  // beside `fileIndexKeys: null` and a mismatch disposition. That is partial
  // trust in an artifact this path declined to trust, and a reader has no way to
  // tell which half to believe. Either the artifact was identified and both are
  // reportable, or it was not and neither is.
  producedBy: artifactIdentity ? (ws?.generated?.by?.name ?? null) : null,
  fileIndexKeys: integrity.fileIndexKeys,
  repository: artifactIdentity?.repository ?? null, revision: artifactIdentity?.revision ?? null, integrity: integrity.integrity,
};
if (integrity.integrity === "exact-match") {
  repositoryRelativePath = integrity.repositoryRelativePath;
  projectPrefix = repositoryRelativePath.slice(0, repositoryRelativePath.length - dbtFilePath.length).replace(/\/$/, "");
  method = "manifest-join";
  records.push({ claim: `producing file ${repositoryRelativePath} is tracked in the corpus-matched workspace.json artifact`, observation: integrity.detail, source: "workspacejson", checkExecuted: true });
  note("partners", "workspacejson", "indeterminate", "The artifact resolves the exact source but contains no behavioral co-change evidence, so no partners are asserted.", { completeness: "not-established", observedCount: 0 });
} else if (!unavailable.some((u) => u.field === "partners")) {
  // A refusal never observed an empty collection. Keep its count absent — the
  // exact-match branch above carries `observedCount: 0` because it looked at a
  // matched artifact and found nothing; here nothing was looked at.
  //
  // `completeness` is not optional the same way. The contract rejects "an
  // indeterminate resolution without an explicit completeness state", and until
  // 2026-07-29 this branch omitted it — so *every* event on the unresolved path
  // failed its own validator with "partners is indeterminate without stating
  // completeness". Found by running the path rather than reading it, while
  // producing the first event that populates `unresolvedRecords`. The path had
  // never been exercised end to end; the emitter's only committed outputs all
  // resolve.
  const refused = integrity.integrity === "artifact-unavailable";
  note(
    "partners",
    "workspacejson",
    refused ? "not-queried" : "indeterminate",
    integrity.detail,
    refused ? {} : { completeness: "not-established" },
  );
}

// ---------------------------------------------------------------------------
const { deriveTier, validateEvent, CHANGE_IMPACT_EVENT_VERSION } = await load(
  "src/integration/change-impact-event.ts",
);

const event = {
  eventVersion: CHANGE_IMPACT_EVENT_VERSION,
  provenance: {
    producedAt: new Date().toISOString(),
    producer: { name: "@workspacejson/datahub-agent", version: "0.0.1" },
    datahub: { gmsUrl: GMS, gmsVersion },
    corpus: { repository: SUBJECT_REPOSITORY, commit: SUBJECT_REVISION },
    workspaceArtifact,
  },
  subject: { urn: URN },
  datahub: {
    name: dataset.name,
    platform: dataset.platform,
    description: dataset.description,
    upstreams,
    downstreams,
    lineageObservation,
    schemaFieldCount,
    owners: dataset.owners,
    domain: dataset.domain,
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
    // HAC-267 added the field; a field no producer populates is the same gap as
    // machinery with no consumer, facing the other way. The subject is the only
    // dataset requested, so when it does not resolve it is the unresolved one —
    // its name is not derived, inferred, or authored, it is the URN that was
    // asked for. The reason comes from the corpus-match disposition the join
    // already computed, through the producer's documented vocabulary.
    unresolvedRecords: unresolvedRecordsFor(URN, integrity.integrity),
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
console.error(
  `transport    ${TRANSPORT === "mcp"
    ? `official DataHub MCP server over stdio — ${mcpServer?.serverName ?? "?"} ${mcpServer?.serverVersion ?? "?"} (${MCP_COMMAND})`
    : `direct DataHub GraphQL/GMS API at ${GMS}`}`,
);
console.error(`resolution   ${method}  ->  ${repositoryRelativePath ?? "(unresolved)"}`);
console.error(`prefix       ${projectPrefix === "" ? "(repository root)" : projectPrefix ?? "(unknown)"}`);
console.error(`lineage      ${upstreams.length} up / ${downstreams.length} down`);
console.error(`evidence     ${event.evidence.tier} (${records.length} record(s))`);
console.error(`unavailable  ${unavailable.length} stated`);
console.error(problems.length ? `INVALID:\n  ${problems.join("\n  ")}` : "contract   valid");

// The MCP server is a child process. Leaving it running would hold the emitter
// open past the point it has produced its artifact.
await mcpClient?.stop();

process.exit(problems.length ? 1 : 0);
