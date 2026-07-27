import { describe, expect, it } from "vitest";
import { assessWorkspaceEvidence } from "../../src/integration/workspace-evidence.js";

const subject = { repository: "https://github.com/dcaribou/transfermarkt-datasets", revision: "59fa295c" };
const index = { "dbt/models/curated/game_events.sql": {} };

describe("workspace evidence integrity", () => {
  it("allows the one exact corpus-matched repository path", () => {
    expect(assessWorkspaceEvidence(subject, subject, index, "models/curated/game_events.sql")).toMatchObject({
      integrity: "exact-match", repositoryRelativePath: "dbt/models/curated/game_events.sql",
    });
  });
  it("refuses a repository mismatch", () => {
    expect(assessWorkspaceEvidence(subject, { ...subject, repository: "https://github.com/dbt-labs/jaffle_shop_duckdb" }, index, "models/curated/game_events.sql").integrity).toBe("repository-mismatch");
  });
  it("refuses a revision mismatch", () => {
    expect(assessWorkspaceEvidence(subject, { ...subject, revision: "other" }, index, "models/curated/game_events.sql").integrity).toBe("revision-mismatch");
  });
  it("states unavailable artifacts", () => {
    expect(assessWorkspaceEvidence(subject, null, null, "models/curated/game_events.sql").integrity).toBe("artifact-unavailable");
  });
  it("refuses zero path candidates", () => {
    expect(assessWorkspaceEvidence(subject, subject, index, "models/missing.sql").integrity).toBe("path-unresolved");
  });
  it("refuses ambiguous path candidates", () => {
    expect(assessWorkspaceEvidence(subject, subject, { ...index, "other/models/curated/game_events.sql": {} }, "models/curated/game_events.sql").integrity).toBe("path-ambiguous");
  });
});
