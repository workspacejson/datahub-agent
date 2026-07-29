import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateBundle } from "../../src/integration/plan-comparison.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const evidence = join(root, "evaluation/hac-152");
const bundle = JSON.parse(readFileSync(join(evidence, "live-qwen-judge-run-bundle.json"), "utf8"));

describe("HAC-152 committed live evidence package", () => {
  it("has a checksum for every committed JSON artifact", () => {
    const sums = readFileSync(join(evidence, "SHA256SUMS"), "utf8");
    for (const name of ["live-mcp-event.json", "live-event-with-writeback.json", "live-qwen-judge-run-bundle.json"]) {
      const digest = createHash("sha256").update(readFileSync(join(evidence, name))).digest("hex");
      expect(sums).toContain(`${digest}  ${name}`);
    }
  });

  it("keeps the real Qwen paired bundle valid and its limitations visible", () => {
    expect(validateBundle(bundle)).toEqual([]);
    expect(bundle.comparison.joinedPlan.run.model).toBe("qwen-plus");
    expect(bundle.comparison.deltas).toHaveLength(3);
    expect(bundle.event.datahub.lineageObservation.upstreams).toMatchObject({ read: "failed", completeness: "not-established" });
    expect(bundle.event.writeback).toMatchObject({ succeeded: true, noop: false, bothStatesRead: true });
  });
});
