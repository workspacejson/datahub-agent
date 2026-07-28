/**
 * A corpus-matched `ChangeImpactEvent`, shaped exactly as the emitter produces
 * one. Shared so every cockpit test that needs an event exercises the real
 * contract rather than a hand-shaped stand-in that only resembles it.
 */
import { CHANGE_IMPACT_EVENT_VERSION, type ChangeImpactEvent } from "@contract";

const COMMIT = "59fa295c51fc23466f3a71542f8bf3d1335daa83";
const REPO = "https://github.com/dcaribou/transfermarkt-datasets";
const URN = "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.game_events,PROD)";

export function contractEvent(overrides: Partial<ChangeImpactEvent> = {}): ChangeImpactEvent {
  return {
    eventVersion: CHANGE_IMPACT_EVENT_VERSION,
    provenance: {
      producedAt: "2026-07-27T00:00:00.000Z",
      producer: { name: "@workspacejson/datahub-agent", version: "0.0.1" },
      datahub: { gmsUrl: "http://localhost:8080", gmsVersion: "v1.5.0.6" },
      corpus: { repository: REPO, commit: COMMIT },
      workspaceArtifact: {
        producedBy: "@workspacejson/cli",
        fileIndexKeys: 131,
        repository: REPO,
        revision: COMMIT,
        integrity: "exact-match",
      },
    },
    subject: { urn: URN },
    datahub: {
      name: "game_events",
      platform: "dbt",
      description: null,
      upstreams: [{ urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,duck.dev.games,PROD)", name: "games", degree: 1 }],
      downstreams: [],
      lineageObservation: {
        upstreams: { read: "ok", completeness: "not-established", observedCount: 1 },
        downstreams: { read: "ok", completeness: "not-established", observedCount: 0 },
      },
      schemaFieldCount: 12,
      owners: [],
      domain: null,
    },
    code: {
      dbtUniqueId: "model.transfermarkt_datasets.game_events",
      dbtFilePath: "models/curated/game_events.sql",
      repositoryRelativePath: "dbt/models/curated/game_events.sql",
      projectPrefix: "dbt",
      method: "manifest-join",
      sourceUrl: null,
    },
    partners: [],
    evidence: {
      records: [{ claim: "tracked", observation: "key present", source: "workspacejson", checkExecuted: true }],
      tier: "VERIFIED",
    },
    accounting: {
      datasetsRequested: 1, datasetsResolved: 1, datasetsUnresolved: 0, nodesDropped: 0, nodesExcluded: {},
    },
    unavailable: [
      { field: "datahub.downstreams", source: "datahub", reason: "indeterminate", detail: "The catalog returned no downstream edges; completeness was not established.", completeness: "not-established", observedCount: 0 },
      { field: "partners", source: "workspacejson", reason: "absent", detail: "The artifact carries file-index keys but no behavioral co-change values." },
    ],
    ...overrides,
  };
}

