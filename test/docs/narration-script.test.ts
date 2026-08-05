import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The narration track is the one judge-facing surface with no automatic check.
 *
 * Everything else that makes a claim is pinned to something: the README to the
 * fixtures, the diagrams to the evaluation, the cockpit to its architecture
 * invariants. A voiceover is read once, rendered to audio, and uploaded, and
 * nothing in the repository ever sees it again. So the claims that were removed
 * in review get a test rather than a note asking the next person to remember.
 *
 * All three were caught in review of a draft: "workspace.json adds revision-bound
 * repository relationships" (the bound event carries `partners: []`), "data blast
 * radius" (collapses observed lineage into complete impact), and "a judge path
 * that reproduces the evidence" (a judge can verify preserved evidence; the live
 * Transfermarkt environment is not a clean-clone reproduction).
 *
 * Asserted against `scenes.json` rather than the markdown, and that distinction
 * is the whole reason this file can exist: `script.md` names each banned phrase
 * in the section that forbids it, so a naive scan of the prose would fail on the
 * documentation that prevents the defect.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const scenes = JSON.parse(readFileSync(join(repoRoot, "demo/narration/scenes.json"), "utf8")) as {
  specification: { spokenWordTarget: { min: number; max: number }; masterDurationCeilingSeconds: number };
  totals: { wordCount: number; durationSeconds: number };
  scenes: { id: string; order: number; startSeconds: number; endSeconds: number; durationSeconds: number; narration: string; wordCount: number }[];
};
const script = readFileSync(join(repoRoot, "demo/narration/script.md"), "utf8");
const spoken = scenes.scenes.map((s) => s.narration).join(" ").toLowerCase();

describe("the narration makes no claim the evidence does not support", () => {
  it.each([
    ["revision-bound repository relationships", "the bound event carries partners: [] and relationships: null"],
    ["blast radius", "collapses observed lineage into complete impact"],
    ["reproduces the evidence", "a judge verifies preserved evidence; the live environment is not a clean-clone reproduction"],
    ["behavioral", "Tally establishes no behavioral evidence"],
    ["co-change", "Tally establishes no co-change partners"],
  ])("never says %s", (phrase, why) => {
    expect(spoken, `narration says "${phrase}", but ${why}`).not.toContain(phrase);
  });

  it("says what a judge can actually do with the evidence", () => {
    // The positive half. Banning "reproduces" is satisfied by saying nothing at
    // all, which would drop the OSS proof rather than correct it.
    expect(spoken).toMatch(/verify it|verifies|verification/);
    expect(spoken).toContain("apache-2.0");
  });

  it("discloses the workspace.json relationship exactly once", () => {
    // Once is disclosure. Repeated, it reads as a pitch for the standard rather
    // than for the DataHub application being judged.
    const mentions = scenes.scenes.filter((s) => /i created and maintain/i.test(s.narration));
    expect(mentions).toHaveLength(1);
  });

  it("still names the measured paired result", () => {
    // The single strongest claim in the script. A guard that only removes things
    // would pass on a narration that had quietly lost it.
    expect(spoken).toContain("zero datahub-only plans");
    expect(spoken).toContain("all ten joined-context plans");
  });

  it("would catch a banned phrase reaching a scene", () => {
    // The detector. Every assertion above is a `not.toContain`, which passes on
    // a file with no scenes at all.
    expect(scenes.scenes.length).toBeGreaterThan(0);
    const regressed = `${spoken} workspace.json adds revision-bound repository relationships`;
    expect(regressed).toContain("revision-bound repository relationships");
  });
});

describe("the narration fits the specification it states", () => {
  it("targets 230 to 270 spoken words with a 170 second ceiling", () => {
    // The previous specification said 150-170 words, which over this runtime is
    // roughly 60 wpm: not measured delivery, padding around a video with nothing
    // left to say. Recorded here so the number cannot drift back silently.
    expect(scenes.specification.spokenWordTarget).toEqual({ min: 230, max: 270 });
    expect(scenes.specification.masterDurationCeilingSeconds).toBe(170);
    expect(script).toContain("**Target: 230–270 spoken words. Master duration ceiling: 170 seconds.**");
  });

  it("lands inside the word target", () => {
    const counted = scenes.scenes.reduce((sum, s) => sum + s.narration.split(/\s+/).length, 0);
    expect(counted).toBe(scenes.totals.wordCount);
    expect(counted).toBeGreaterThanOrEqual(scenes.specification.spokenWordTarget.min);
    expect(counted).toBeLessThanOrEqual(scenes.specification.spokenWordTarget.max);
  });

  it("stays under the master duration ceiling", () => {
    expect(scenes.totals.durationSeconds).toBeLessThanOrEqual(scenes.specification.masterDurationCeilingSeconds);
  });

  it("runs continuously, with no gap or overlap between scenes", () => {
    expect(scenes.scenes[0]?.startSeconds).toBe(0);
    for (const [i, scene] of scenes.scenes.entries()) {
      expect(scene.durationSeconds, `${scene.id} duration`).toBe(scene.endSeconds - scene.startSeconds);
      const next = scenes.scenes[i + 1];
      if (next) expect(next.startSeconds, `gap or overlap after ${scene.id}`).toBe(scene.endSeconds);
    }
  });

  it("gives the closing line seven seconds, not five", () => {
    // At five seconds the close ran near 190 wpm, which delivers the claim as a
    // throwaway. The close is the claim.
    const close = scenes.scenes.at(-1);
    expect(close?.durationSeconds).toBeGreaterThanOrEqual(7);
  });

  it("keeps every scene inside a deliverable speaking rate", () => {
    // An upper bound only. Slow scenes are a directing choice; a scene nobody can
    // read aloud in its slot is a re-cut discovered in the booth.
    for (const scene of scenes.scenes) {
      const wpm = (scene.wordCount / scene.durationSeconds) * 60;
      expect(wpm, `${scene.id} needs ${wpm.toFixed(0)} wpm`).toBeLessThanOrEqual(160);
    }
  });

  it("keeps script.md and scenes.json saying the same words", () => {
    // scenes.json is generated from the prose and declared canonical. If they
    // drift, the audio and the thing a human reviewed are different scripts.
    for (const scene of scenes.scenes) {
      const collapsed = script.replace(/\n>\s*/g, " ").replace(/\s+/g, " ");
      expect(collapsed, `${scene.id} is not in script.md verbatim`).toContain(scene.narration);
    }
  });
});
