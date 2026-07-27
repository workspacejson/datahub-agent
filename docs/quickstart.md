# Local DataHub quickstart

This application talks to DataHub over the official DataHub MCP server. For local development you need a running local DataHub instance.

## 1. Start local DataHub

DataHub ships an official CLI-driven Docker quickstart. Requires Docker running locally.

```bash
python3 -m pip install --upgrade acryl-datahub
datahub docker quickstart
```

This brings up the full local DataHub stack (GMS, frontend, Kafka, Elasticsearch/OpenSearch, MySQL). Once it completes:

- UI: http://localhost:9002 (default login `datahub` / `datahub`)
- GMS API: http://localhost:8080

Tear down with:

```bash
datahub docker nuke
```

## 2. Point this application at it

This application consumes DataHub via the official DataHub MCP server, not direct GMS calls. Configuration for the MCP endpoint and any local credentials will live in this application's own config once the agent implementation (tracked under [HAC-148](https://linear.app/marcelle-labs/issue/HAC-148)) lands.

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

## 4. Run the examples

See [`examples/`](../examples) for runnable, judge-visible usage once available.

## Notes

- This quickstart is intentionally daemon-free with respect to Vreko: nothing here starts, requires, or assumes a Vreko process. See [`docs/clean-room.md`](clean-room.md).
- For DataHub's own quickstart options (Kubernetes, custom compose overrides, upgrading), see the [official DataHub docs](https://docs.datahub.com/docs/quickstart).
