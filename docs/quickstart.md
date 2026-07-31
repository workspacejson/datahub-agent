# Local DataHub quickstart

> **Type:** Guide | **Status:** Current | **Scope:** Local development setup

This application reads DataHub through the official DataHub MCP server
(`acryldata/mcp-server-datahub`), spawned over stdio. For local development you
need a running local DataHub instance and that server installed.

A note on what this page used to say, because the correction is the point. It
claimed the same thing while the read path issued GraphQL directly to GMS and
merely restricted itself to the fields the MCP server projects. That restriction
was real and measured, and it was not the same claim: "we ask for the fields MCP
would" describes a request body, "we read through the official MCP server"
describes a transport. The transport is now what the sentence says it is, and
`--transport gms` is the flag that says the other thing honestly.

## 1. Start local DataHub

DataHub ships an official CLI-driven Docker quickstart. Requires Docker running locally.

```bash
python3 -m pip install --upgrade 'acryl-datahub[dbt]'
datahub docker quickstart
```

Install the `[dbt]` extra, not bare `acryl-datahub`. Without it `datahub ingest`
fails the dbt recipe with *"dbt is disabled due to a missing dependency: boto3"*
— a clear message, but one that arrives only when you try to ingest, long after
the quickstart has succeeded.

Set `DATAHUB_TELEMETRY_ENABLED=false` if you are on a restricted network. The CLI
and the MCP server both block on an outbound telemetry POST with retries, which
looks like a hang rather than a network problem.

This brings up the full local DataHub stack (GMS, frontend, Kafka, Elasticsearch/OpenSearch, MySQL). Once it completes:

- UI: http://localhost:9002 (default login `datahub` / `datahub`)
- GMS API: http://localhost:8080

Tear down with:

```bash
datahub docker nuke
```

## 2. Install the official DataHub MCP server

```bash
python3 -m pip install --upgrade mcp-server-datahub
```

The read path spawns it as `mcp-server-datahub --transport stdio` and points it
at GMS through `DATAHUB_GMS_URL`. It also sets `DATAHUB_TELEMETRY_ENABLED=false`
for the child, because the server blocks its own startup on an outbound
telemetry POST — on a restricted network the MCP handshake otherwise spends
about forty seconds in connect-retry before answering.

Override the binary with `--mcp-command` if it is not on `PATH`:

```bash
node scripts/emit-change-impact-event.mjs '<urn>' \
  --mcp-command /path/to/venv/bin/mcp-server-datahub \
  --subject-repository <url> --subject-revision <sha> \
  --workspace-artifact .agents/workspace.json
```

The emitter refuses to start if the server does not advertise `get_entities`,
`get_lineage` and `list_schema_fields`, rather than discovering a missing tool
part-way through and emitting an event that is half measurement and half version
complaint.

### Reading the same instance both ways

```bash
node scripts/emit-change-impact-event.mjs '<urn>' --transport gms  ...
```

`--transport gms` is the direct DataHub GraphQL/GMS read. It is kept because the
comparison is the evidence: run both against one instance and the MCP boundary
costs something specific rather than being asserted to. Measured against the
pinned corpus on GMS `v1.5.0.6`, the two agree on the upstream URN set, the
degrees, `schemaFieldCount` and `code.sourceUrl`, and differ in exactly two
places:

- `provenance.datahub.gmsVersion` is null over MCP. No MCP tool reports the
  server version, and the event states that as `not-exposed-by-source` rather
  than reaching for a second transport to fill the field in.
- Seven edge `name`s — six upstream and one downstream — are populated over MCP
  and null over direct GraphQL. The direct query reads `properties.name` through
  a `... on Dataset` fragment; the duckdb sibling datasets carry their name at
  the top level. The MCP read is the better of the two here.

## 3. Produce a workspace.json for any repository

The producer is on the public registry, so this needs no checkout of this
project and no credentials:

```bash
npm install @workspacejson/cli
npx workspacejson generate .
```

That writes `.agents/workspace.json`, whose `generated.fileIndex` is keyed by
repository-root-relative POSIX path — the key this application joins DataHub
dataset URNs against.

Two properties worth checking yourself, because the join depends on both:

```bash
# the artifact converges — a second run is byte-identical
npx workspacejson generate . && shasum -a 256 .agents/workspace.json
npx workspacejson generate . && shasum -a 256 .agents/workspace.json

# it does not index its own output
jq '.generated.fileIndex | has(".agents/workspace.json")' .agents/workspace.json   # false
```

Per-file values are intentionally empty. `FileIndexEntry` declares them
optional, and the producer withholds behavioral values by design — the join is
key membership, not value reading.

## 4. Enrich

The writeback annotates the dataset with the evidence tier, and with a
commit-pinned link to the producing file when one is obtainable.

It writes to `http://localhost:8080` unless `--gms URL` names another instance,
so read the plan before sending it. A dry run prints the exact mutations and
variables and contacts the catalog for nothing:

```bash
node scripts/run-writeback.mjs event.json --dry-run
```

When the plan reads correctly, run it for real:

```bash
node scripts/run-writeback.mjs event.json
```

It is idempotent, so the second run reports `noop`.

On the pinned GMS `v1.5.0.6`, both mutations are additive. Reading the resolver
sources at that tag shows `upsertStructuredProperties` merging into the
properties already on the dataset, and `upsertLink` appending to institutional
memory, so neither is written in a way that replaces metadata this tool does not
own.

That is source inspection at one pinned version, not observed behaviour, and it
establishes less than it may appear to. It does not establish transaction-level
safety: the merge is a server-side read-modify-write, so concurrent writers to
the same dataset can still lose an update. It says nothing about other GMS
versions, and DataHub's own tutorial describes an aspect-level replace instead,
so the claim is scoped to the tag named here and needs rechecking if the pin
moves. See the note in
[`src/integration/writeback.ts`](../src/integration/writeback.ts).

## 5. Run the examples

See [`examples/`](../examples) for runnable, judge-visible usage once available.

## 6. Run the paired Qwen plan comparison

The paired comparison invokes the same Qwen model twice through its
OpenAI-compatible endpoint. The task prompt, model identifier, decoding
settings, emitted event, and DataHub snapshot are held constant; only the
context envelope differs. The `datahub-only` envelope is mechanically reduced
with `toDataHubOnly`, while the joined envelope retains the exact
corpus-matched repository-relative source and pinned revision.

Do not put provider credentials in an event, bundle, fixture, or shell history.
Provide the API key through an environment variable:

```bash
node --import tsx scripts/run-paired-plan-comparison.mjs \
  --event event-with-writeback.json --out judge-run-bundle.json \
  --task-id add-quality-check \
  --prompt 'Add a dbt quality check for game_events.' \
  --model <qwen-model-id> --settings '{"temperature":0}' \
  --api-key-env OPENAI_API_KEY
```

`--api-key-env` names an environment variable only; it never places a key in
the command, artifact, or repository. Set the environment variable in your
shell before running, using whatever secret manager your environment
provides.

The runner refuses a DataHub-only answer unless it explicitly refuses the
unknown source location, and refuses a joined answer unless it uses the exact
repository-relative path and revision in the event. It also refuses invalid or
empty comparisons. `judge-run-bundle.json` is therefore a fresh model artifact,
not a checked-in stand-in. If the local DataHub instance is unavailable, the
input event may be fixture-based, which must be stated alongside the result.

## Notes

- This quickstart is intentionally daemon-free: nothing here starts, requires, or assumes a background process beyond Docker for DataHub. See [`docs/clean-room.md`](clean-room.md).
- For DataHub's own quickstart options (Kubernetes, custom compose overrides, upgrading), see the [official DataHub docs](https://docs.datahub.com/docs/quickstart).
