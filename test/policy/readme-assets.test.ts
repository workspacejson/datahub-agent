import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The README's asset layer, held to the same standard as its prose.
 *
 * `validate-asset-registry.mjs` walks the *declarations* and checks each one
 * against a file. It structurally cannot report the inverse — a checked-in asset
 * that no record declares is invisible to a validator that only reads
 * declarations, which is how eight images sat unregistered under `assets/` for a
 * day with the gate green throughout. These tests walk the *filesystem* and the
 * *README*, so the two directions are both covered.
 *
 * The order assertion is the one that looks fussy and is not. The README's claim
 * on a reader's attention is that it argues in a sequence: what the product is,
 * then what changed when context was joined, then why, then how the boundary
 * holds. An image moved out of that order does not fail anything at build time;
 * it just quietly turns a narrative back into the gallery it was rewritten to
 * stop being.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const README = readFileSync(join(repoRoot, "README.md"), "utf8");
const manifest = JSON.parse(readFileSync(join(repoRoot, "assets/manifest.json"), "utf8")) as {
  assets: {
    id: string;
    canonicalPath: string;
    sha256: string;
    approvalState: string;
    publicUse: string;
    destinationEligibility: Record<string, string>;
    export: { width: number; height: number };
    editableSource: { path: string | null };
  }[];
};
const byPath = new Map(manifest.assets.map((a) => [a.canonicalPath, a]));

/** Every image the README actually renders, in the order a reader meets them. */
const readmeImages: string[] = [...README.matchAll(/<img\s[^>]*src="([^"]+)"/g)].flatMap((m) => m[1] ?? []);

/**
 * Images a `<picture>` can serve instead of the `<img>`, which a reader can
 * meet without the `<img>` ever rendering.
 *
 * Verified against GitHub's own sanitizer rather than assumed: posting the
 * walkthrough's `<picture>` to `POST /markdown` returns it with the `media` and
 * `srcset` attributes intact, so the reduced-motion source really is served. An
 * asset that reaches a reader is governed, so these join the checks below rather
 * than sitting outside them because they are not `<img src>`.
 */
const readmeSources: string[] = [...README.matchAll(/<source\s[^>]*srcset="([^"]+)"/g)].flatMap((m) => m[1] ?? []);

/** Everything the README can put in front of a reader. */
const readmeRendered: string[] = [...readmeImages, ...readmeSources];

/** Display formats. Anything else under exports/ is provenance, not an asset. */
const DISPLAY_EXTENSIONS = [".png", ".svg", ".gif", ".jpg", ".jpeg", ".webp"];

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("the loose readme export directory is gone", () => {
  it("assets/exports/readme/ does not exist, or holds nothing", () => {
    // `assets/exports/<asset-id>/` is one directory per registry record, so a
    // record and its file cannot drift apart by filename. A shared `readme/`
    // bucket breaks exactly that property.
    const loose = join(repoRoot, "assets/exports/readme");
    const contents = existsSync(loose) ? walk(loose) : [];
    expect(contents, `assets/exports/readme/ still holds ${contents.length} file(s)`).toEqual([]);
  });
});

describe("every checked-in display asset is declared", () => {
  const discovered = walk(join(repoRoot, "assets/exports"))
    .filter((f) => DISPLAY_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)))
    .map((f) => f.slice(repoRoot.length + 1));

  it("finds display assets to check", () => {
    expect(discovered.length).toBeGreaterThan(0);
  });

  it.each(discovered)("%s has a registry record", (path) => {
    expect(byPath.has(path), `${path} is checked in under assets/exports/ but no manifest record declares it`).toBe(true);
  });

  it("holds no editable source under exports/", () => {
    // The `.dc.html` canvases are sources, not exports. One home each.
    const sources = walk(join(repoRoot, "assets/exports")).filter((f) => f.endsWith(".dc.html"));
    expect(sources).toEqual([]);
  });
});

describe("every README image is a governed, approved asset", () => {
  it("renders at least one image", () => {
    expect(readmeImages.length).toBeGreaterThan(0);
  });

  it("checks the reduced-motion source too, not only the img", () => {
    // Guards the guard: if the `<picture>` were reduced to a bare `<img>`, this
    // list would silently empty and the checks below would stop covering it.
    expect(readmeSources).toContain(
      "assets/exports/readme-walkthrough-1440x1100-poster/readme-walkthrough-1440x1100-poster.png",
    );
  });

  it.each(readmeRendered)("%s exists on disk", (src) => {
    expect(existsSync(join(repoRoot, src)), `README renders ${src} but it does not exist`).toBe(true);
  });

  it.each(readmeRendered)("%s is registered", (src) => {
    expect(byPath.has(src), `README renders ${src} but no manifest record declares it`).toBe(true);
  });

  it.each(readmeRendered)("%s is approved for github-readme", (src) => {
    const record = byPath.get(src);
    expect(record, `no record for ${src}`).toBeDefined();
    if (!record) return;
    // Three separate states, all required. Approving the asset without allowing
    // public use, or allowing public use without approving this destination, is
    // a half-approval that the registry's own vocabulary can express and that
    // nothing else would catch.
    expect(record.approvalState, `${src} approvalState`).toBe("approved");
    expect(record.publicUse, `${src} publicUse`).toBe("allowed");
    expect(record.destinationEligibility.github, `${src} github eligibility`).toBe("approved");
  });

  it.each(readmeRendered)("%s matches its recorded digest", (src) => {
    const record = byPath.get(src);
    if (!record) return;
    const actual = createHash("sha256").update(readFileSync(join(repoRoot, src))).digest("hex");
    expect(actual, `${src} bytes have changed since registration`).toBe(record.sha256);
  });
});

describe("the README shows the new assets and not the ones they replaced", () => {
  it("references the new hero", () => {
    expect(README).toContain("assets/exports/readme-tally-hero-1280x440/readme-tally-hero-1280x440.png");
  });

  it("references the new cockpit architecture boundary", () => {
    expect(README).toContain(
      "assets/exports/readme-cockpit-architecture-boundary-1800x1100/readme-cockpit-architecture-boundary-1800x1100.png",
    );
  });

  it.each(["github-hero-dark-1280x440", "github-hero-light-1280x440"])(
    "does not reference the old %s hero",
    (id) => {
      expect(README, `README still references the superseded ${id}`).not.toContain(id);
    },
  );

  it("does not reference the old architecture image", () => {
    // Both the SVG and its PNG sibling. Showing either beside the new boundary
    // diagram would put two architecture pictures on one page making different
    // claims about the same system.
    expect(README).not.toContain("tally-architecture");
  });
});

describe("the README's images appear in the narrative order", () => {
  it("runs product, walkthrough, HAC-150, context gap, architecture, contribution poster, node accounting, feedback", () => {
    /*
      The poster moved, and the order moved with it.

      It used to sit third, illustrating the silent-failure section, because the
      frame it captured held the naive join beside the resolved path. The cockpit
      reduction pass moved the naive join below the fold on Impact, so the frame
      no longer shows it and the poster no longer illustrates that section. It now
      captures the contribution band, which is exactly the claim "What each side
      contributes" makes, and it is placed there.

      A poster captioned "the naive join returns zero matches" over an image
      containing no naive join was the alternative, and that is the failure this
      whole ordering guard exists to make visible rather than tolerable.
    */
    const expected = [
      "readme-tally-hero-1280x440",
      "readme-walkthrough-1440x1100/",
      "readme-hac-150-paired-evaluation-1400x620",
      "readme-context-gap-1200x780",
      "readme-cockpit-architecture-boundary-1800x1100",
      "readme-poster-impact-2560x642",
      "readme-node-accounting-1200x780",
      "readme-datahub-feedback-synthesis-1400x1110",
    ];
    // Rendered images only. The walkthrough's poster is linked as a static
    // alternative rather than rendered, so it is deliberately not in this list.
    const actual = expected.map((id) => readmeImages.findIndex((src) => src.includes(id)));
    for (const [i, position] of actual.entries()) {
      expect(position, `${expected[i]} is not rendered by the README`).toBeGreaterThanOrEqual(0);
    }
    expect(actual, `README image order is ${actual.join(", ")}, expected ascending`).toEqual([...actual].sort((a, b) => a - b));
  });

  it("would catch two images swapped", () => {
    // The detector. `toEqual(sorted)` passes trivially on a one-element list, so
    // this proves the assertion above is actually ordering something.
    const swapped = [3, 1, 2];
    expect(swapped).not.toEqual([...swapped].sort((a, b) => a - b));
  });
});

describe("the five authored exports have the dimensions their records claim", () => {
  const EXPECTED: Record<string, { width: number; height: number }> = {
    "readme-tally-hero-1280x440": { width: 2560, height: 880 },
    "readme-cockpit-architecture-boundary-1800x1100": { width: 3600, height: 2200 },
    "readme-hac-150-paired-evaluation-1400x620": { width: 2800, height: 1240 },
    // The id names the declared 1200x780 canvas; the root element sets no
    // height, so the export takes its height from the content. Both numbers are
    // real and neither is derived from the other.
    "readme-node-accounting-1200x780": { width: 2400, height: 1660 },
    "readme-datahub-feedback-synthesis-1400x1110": { width: 2800, height: 2220 },
  };

  it.each(Object.entries(EXPECTED))("%s is %o in the file and in its record", (id, expected) => {
    const path = join(repoRoot, `assets/exports/${id}/${id}.png`);
    const bytes = readFileSync(path);
    // IHDR is fixed-offset and always the first chunk.
    const actual = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    expect(actual, `${id} pixel dimensions`).toEqual(expected);

    const record = manifest.assets.find((a) => a.id === id);
    expect(record, `no record for ${id}`).toBeDefined();
    expect({ width: record?.export.width, height: record?.export.height }, `${id} recorded dimensions`).toEqual(expected);
  });
});

describe("the corrected copy is in the source and its superseded form is not", () => {
  /*
    Both corrections fix a claim, not a typo.

    "context envelope only variable" because HAC-150 varies the context
    envelope, and "context only variable" would describe an experiment that was
    not run. "proof-corpus node" because the accounting covers the pinned proof
    corpus rather than dbt in general, and the broader wording overstates the
    scope of a fixed measurement.

    Asserted in both directions. Presence alone passes on a source containing
    both strings, which is exactly what a careless find-and-add would produce.
  */
  const CORRECTIONS = [
    {
      id: "readme-hac-150-paired-evaluation-1400x620",
      present: "context envelope only variable",
      absent: "context only variable",
    },
    {
      id: "readme-node-accounting-1200x780",
      present: "Every proof-corpus node is accounted for",
      absent: "Every dbt node is accounted for",
    },
  ];

  it.each(CORRECTIONS)("$id carries the corrected phrase", ({ id, present, absent }) => {
    const source = readFileSync(join(repoRoot, `assets/source/${id}/${id}.dc.html`), "utf8");
    expect(source, `${id} source is missing ${JSON.stringify(present)}`).toContain(present);
    expect(source, `${id} source still contains the superseded ${JSON.stringify(absent)}`).not.toContain(absent);
  });

  it.each(CORRECTIONS)("$id's source is the one its record names", ({ id }) => {
    // A corrected source nothing points at would satisfy the assertion above
    // while the README kept showing an export made from the old one.
    const record = manifest.assets.find((a) => a.id === id);
    expect(record?.editableSource.path).toBe(`assets/source/${id}/${id}.dc.html`);
  });
});

describe("the quantitative images stay pinned to the evidence they quote", () => {
  it("keeps the HAC-150 figures in agreement with the evaluation", () => {
    const source = readFileSync(
      join(repoRoot, "assets/source/readme-hac-150-paired-evaluation-1400x620/readme-hac-150-paired-evaluation-1400x620.dc.html"),
      "utf8",
    );
    const aggregate = JSON.parse(readFileSync(join(repoRoot, "evaluation/hac-150/aggregate.json"), "utf8"));
    const manifestJson = JSON.parse(readFileSync(join(repoRoot, "evaluation/hac-150/manifest.json"), "utf8"));

    const revision = aggregate.measures.exactRevisionOnlyInJoined;
    expect(source).toContain(`${revision.count}/${revision.denominator}`);
    expect(source).toContain(`${revision.denominator - revision.count}/${revision.denominator}`);
    expect(source).toContain(String(aggregate.stability.datahubOnly.distinctSequences));
    expect(source).toContain(String(aggregate.stability.joined.distinctSequences));
    // The subject, character for character. An approximation of a pinned
    // revision is a different claim wearing the same shape.
    expect(source).toContain(manifestJson.subject.exactSource);
    expect(source).toContain(manifestJson.subject.exactRevision);
    // The denominator is the pairs requested, never the pairs that conformed.
    expect(revision.denominator).toBe(aggregate.pairsRequested);
  });

  it("keeps the node accounting in agreement with docs/claims.md", () => {
    const source = readFileSync(
      join(repoRoot, "assets/source/readme-node-accounting-1200x780/readme-node-accounting-1200x780.dc.html"),
      "utf8",
    );
    const claims = readFileSync(join(repoRoot, "docs/claims.md"), "utf8");
    for (const figure of ["28", "8", "20", "0", "5"]) expect(source).toContain(figure);
    expect(claims).toContain("| Proof-corpus nodes accounted for | 28 of 28 |");
    expect(claims).toContain("Nodes kept by the legacy `extractModels` | 5 of 28");
    // The alarming framing this figure used to have, and must not regain.
    expect(README).not.toContain("23 discarded");
    expect(source).not.toContain("23 discarded");
  });

  it("keeps the feedback synthesis in agreement with FEEDBACK.md", () => {
    const source = readFileSync(
      join(repoRoot, "assets/source/readme-datahub-feedback-synthesis-1400x1110/readme-datahub-feedback-synthesis-1400x1110.dc.html"),
      "utf8",
    );
    const feedback = readFileSync(join(repoRoot, "FEEDBACK.md"), "utf8");
    const findings = feedback.match(/^## \d+\. /gm) ?? [];
    const openQuestions = feedback.match(/^## The open question/gm) ?? [];
    expect(findings).toHaveLength(11);
    expect(openQuestions).toHaveLength(1);
    // The image says eleven and one; the file has to still hold eleven and one.
    expect(source).toContain("Eleven findings and one open question");
    for (const pr of ["mcp-server-datahub#149", "datahub#18754"]) expect(source).toContain(pr);
  });
});

describe("no new record claims a destination it was not approved for", () => {
  const NEW_IDS = [
    "readme-tally-hero-1280x440",
    "readme-cockpit-architecture-boundary-1800x1100",
    "readme-hac-150-paired-evaluation-1400x620",
    "readme-node-accounting-1200x780",
    "readme-datahub-feedback-synthesis-1400x1110",
  ];

  it.each(NEW_IDS)("%s is approved for github only", (id) => {
    const record = manifest.assets.find((a) => a.id === id);
    expect(record, `no record for ${id}`).toBeDefined();
    if (!record) return;
    expect(record.destinationEligibility.github).toBe("approved");
    // The approval was scoped to this repository's GitHub README. Widening it
    // to a site, a Devpost gallery or a video is a separate decision by a
    // separate person, and the registry must not quietly acquire it.
    for (const destination of ["website", "devpost", "video"]) {
      expect(record.destinationEligibility[destination], `${id} claims ${destination}`).toBe("pending-owner-review");
    }
  });
});

describe("the vendored design tokens have not drifted from the application's", () => {
  it.each(["colors.css", "typography.css"])("%s is byte-identical to apps/cockpit's copy", (file) => {
    /*
      Two vendored copies of one upstream package, which is a duplication worth
      making mechanical rather than removing.

      The asset canvases render from frozen inputs on purpose: an approved export
      carries a registered hash, and binding it to mutable application source
      would let a token tweak change a governed image with nothing failing. That
      safety costs a second copy, and this is the check that stops the copy
      becoming a divergence nobody notices.
    */
    const asset = readFileSync(join(repoRoot, `assets/source/_design-system/tokens/${file}`));
    const app = readFileSync(join(repoRoot, `apps/cockpit/src/styles/tokens/${file}`));
    expect(asset.equals(app), `assets/source/_design-system/tokens/${file} has drifted from apps/cockpit's copy`).toBe(true);
  });

  it("loads no remote font or asset from any authored canvas", () => {
    // The export script refuses a source that touches the network, but it only
    // runs when someone runs it. This fails in CI.
    const sources = walk(join(repoRoot, "assets/source")).filter((f) => f.endsWith(".dc.html") || f.endsWith(".css"));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      const remote = text.match(/(?:src|href)\s*[=:]\s*["']?https?:\/\/[^"')\s]+/g) ?? [];
      const imports = text.match(/@import\s+url\(\s*["']?https?:\/\//g) ?? [];
      expect([...remote, ...imports], `${file.slice(repoRoot.length + 1)} loads a remote resource`).toEqual([]);
    }
  });
});

describe("the judging guide carries exactly one governed image", () => {
  /*
    JUDGING.md became an image-bearing surface on 2026-08-06 and nothing checked
    it. Every governance assertion above reads `README.md` by name, so an
    unregistered, unapproved image placed here would have rendered to judges with
    no record, no digest and no approval — the exact hole the registry was built
    to close, reopened one file to the left.

    The count is pinned at one, and that is a policy rather than an accident of
    the current layout. This file is a routing document: its job is to get a
    judge to the right artifact quickly, and every image is scroll paid before
    reaching a link. The README carries the visual argument. One frame earns its
    place here because the 60-second path describes a visual trap in prose and
    the picture does it at a glance; a second would start turning this into a
    second README. Pinning the count also means the guard cannot go vacuous — a
    removed image fails here rather than silently emptying the checks below.

    Markdown syntax, not `<img>`, because that is what this file uses. The inner
    capture of `[![alt](img)](href)` is the image; the link target is not an
    asset.
  */
  const JUDGING = readFileSync(join(repoRoot, "JUDGING.md"), "utf8");
  const judgingImages: string[] = [...JUDGING.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].flatMap((m) => m[1] ?? []);

  it("renders exactly one image", () => {
    expect(judgingImages, `JUDGING.md renders ${judgingImages.length} images: ${judgingImages.join(", ")}`).toHaveLength(1);
  });

  it.each(judgingImages)("%s exists on disk", (src) => {
    expect(existsSync(join(repoRoot, src)), `JUDGING.md renders ${src} but it does not exist`).toBe(true);
  });

  it.each(judgingImages)("%s is registered and approved for github", (src) => {
    const record = byPath.get(src);
    expect(record, `JUDGING.md renders ${src} but no manifest record declares it`).toBeDefined();
    if (!record) return;
    expect(record.approvalState, `${src} approvalState`).toBe("approved");
    expect(record.publicUse, `${src} publicUse`).toBe("allowed");
    expect(record.destinationEligibility.github, `${src} github eligibility`).toBe("approved");
  });

  it.each(judgingImages)("%s matches its recorded digest", (src) => {
    const record = byPath.get(src);
    if (!record) return;
    const actual = createHash("sha256").update(readFileSync(join(repoRoot, src))).digest("hex");
    expect(actual, `${src} bytes have changed since registration`).toBe(record.sha256);
  });

  it("carries alt text describing the frame, not a filename", () => {
    // An image on an evidence surface with empty or nominal alt text is an
    // unlabelled claim to anyone reading with a screen reader, and this is the
    // first thing a judge meets on the 60-second path.
    const alts = [...JUDGING.matchAll(/!\[([^\]]*)\]\([^)\s]+\)/g)].map((m) => m[1] ?? "");
    expect(alts).toHaveLength(1);
    for (const alt of alts) {
      expect(alt.length, "alt text is too short to describe the frame").toBeGreaterThan(80);
      expect(alt, "alt text names the coordinate seam the section is about").toContain("dbt/models/curated/game_events.sql");
    }
  });
});
