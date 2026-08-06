#!/usr/bin/env node
/**
 * Capture the README product assets from a committed-mode build.
 *
 * The registry's own stated gap is that most raster assets have "no editable
 * source ... so this export cannot be regenerated from this repository" and no
 * reproducible generation method. A screenshot taken by hand reproduces that
 * gap no matter how good the frame is. This script is the generation method: it
 * is checked in, it names the commit it ran against, and it prints the digest
 * that goes in `assets/manifest.json`.
 *
 * Captures against a local production build rather than the deployed site on
 * purpose. The deployed bundle carries no build commit -- every 40-hex string in
 * it is evidence data, not provenance -- so a capture from the URL cannot record
 * `sourceCommit` without trusting a Vercel dashboard lookup that nothing in this
 * repository can check. A local build at HEAD can.
 *
 *   npm run build
 *   node scripts/capture-readme-assets.mjs
 *
 * Refuses on a dirty tree: an asset whose recorded commit does not describe the
 * bytes it was made from is worse than an unrecorded one, because it reads as
 * provenance.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "node:http";
import { extname } from "node:path";

import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cockpit = join(root, "apps", "cockpit");

/**
 * Capture width. Fixed, and the value matters.
 *
 * At 1280 the subject band keeps the dataset name and the file it resolved to on
 * one row, and the contribution band keeps its three cells side by side, which is
 * the actor model the frame exists to show. Below 1100 the contribution band
 * reflows to two columns and then to one, and the subject stacks: the band grows
 * from roughly 3.4:1 to 1.6:1, the pairing is lost, and the image starts
 * dominating the README rather than opening it.
 *
 * The six-cell status strip this used to be anchored on was removed in the
 * reduction pass. Every fact it carried now appears once, in the band that owns
 * it, which is why the crop below is anchored on the subject band rather than on
 * a strip above it.
 */
const WIDTH = 1280;
/** 2x, so the band stays legible when GitHub scales it down to content width. */
const SCALE = 2;
/**
 * Breathing room above the bar and below the hero, in CSS pixels.
 *
 * `PAD_BOTTOM` is a maximum, not a fixed value. The route spine sits directly
 * under the hero, and 24px of padding cut it in half: a poster ending in a
 * sliced row of tab labels reads as a broken screenshot rather than a frame. The
 * crop is clamped to just above whatever follows the hero, so the pad can never
 * reach into the next element no matter how the spacing tokens change.
 */
const PAD_TOP = 8;
const PAD_BOTTOM = 24;
/** Kept clear of the following element by this much, in CSS pixels. */
const NEXT_ELEMENT_GAP = 2;

/**
 * The band's expected height, and a tolerance.
 *
 * The crop is measured from the live elements rather than hardcoded, so a layout
 * change re-crops correctly instead of silently cutting the frame in the wrong
 * place. But a change large enough to move the height this far means the frame
 * is no longer the one that was approved, and the right response is to fail and
 * re-review rather than to publish a different picture under the same caption.
 *
 * 380 was the outcome-bar-plus-hero frame. The reduction pass removed that strip
 * and the crop is now the step rail, the subject band and the contribution band,
 * which measures 321. The gate did its job on the way here: it refused the first
 * capture after the layout changed rather than republishing a different picture
 * under the old caption, and the caption and alt text below were rewritten from
 * the produced image before this number moved.
 */
const EXPECTED_HEIGHT = 321;
const HEIGHT_TOLERANCE = 40;

/**
 * The walkthrough viewport, and why it is wider than the poster's.
 *
 * One viewport for the whole sequence, never resized: a frame that changes shape
 * mid-playback reads as a video edit, and the claim being made is that this is
 * one continuous surface.
 *
 * 1440x1100 is the smallest frame where both states are fully in view with no
 * scrolling. The Impact coordinate rows end at 665 and the Change plan panels end
 * at 1026, so 1100 holds either without moving the page.
 *
 * The width is not interchangeable with the poster's 1280, and the reason is
 * about this asset rather than about the product. Below 1440 a media query
 * switches the stated-gaps list to its compact layout, 6rem instead of 8rem, and
 * the third gap sits behind a scrollbar: 124px of content in a 96px box. That is
 * a valid application layout -- the cap stops the gap list pushing the primary
 * action below the fold -- but it is unsuitable for a walkthrough frame, which
 * has to show the complete gap list beside the comparison. So the capture picks a
 * viewport where the content fits rather than widening the cap for a screenshot.
 * Optimising the product for the marketing asset is how a frame stops being
 * evidence.
 */
const GIF_WIDTH = 1440;
const GIF_HEIGHT = 1100;

/**
 * Frame durations, in seconds. They sum to the total runtime.
 *
 * Paced for reading, not for brevity. The closing state has to be held long
 * enough to read four things -- the refusal reason, the repository-relative path,
 * the pinned revision, and the proposed action -- and that is the whole proof. A
 * shorter loop that renders it unreadable would be a product tour rather than
 * evidence.
 */
const GIF_TIMELINE = [
  { name: "open", seconds: 2.0, note: "Impact: the subject, the file it resolved to, and the naive join below it" },
  { name: "press", seconds: 0.5, note: "the primary action under the pointer, before it is taken" },
  { name: "plan", seconds: 5.5, note: "Change plan: refusal beside evidence-backed action" },
];

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

const dirty = git("status", "--porcelain");
if (dirty && !process.env.ALLOW_DIRTY) {
  console.error(
    "Refusing to capture from a dirty tree: the recorded commit would not describe the bytes captured.\n" +
      "Commit or stash first, or set ALLOW_DIRTY=1 for a throwaway capture that must not be registered.\n\n" +
      dirty,
  );
  process.exit(1);
}

const commit = git("rev-parse", "HEAD");

/**
 * The built cockpit, served exactly the way production serves it.
 *
 * Twenty lines rather than a dependency. Importing vite's `preview` would put
 * vite in the root manifest, and the root already resolves vite 5 transitively
 * while the cockpit workspace is on 8: declaring it here forced a major-version
 * bump across the tree, days from submission, to serve four files.
 *
 * The fallback to `index.html` is not a convenience. It mirrors the single
 * rewrite in `vercel.json` -- `/(.*)` to `/index.html` -- so `/impact` and
 * `/change-plan` resolve here the way they resolve on the deployed origin. A
 * static server without it would 404 both routes and capture nothing.
 */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};
const dist = join(cockpit, "dist");
if (!existsSync(join(dist, "index.html"))) {
  console.error(`No build at ${dist}. Run \`npm run build\` first.`);
  process.exit(1);
}
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const candidate = resolve(dist, `.${path}`);
  // A request that escapes dist is a bug or an attack; either way it is not a
  // file this server owns.
  const inside = candidate.startsWith(`${dist}${sep}`) || candidate === dist;
  const file = inside && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : join(dist, "index.html");
  response.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  response.end(readFileSync(file));
});
await new Promise((ready) => server.listen(4180, "127.0.0.1", ready));
const origin = "http://127.0.0.1:4180";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: 1400 },
    deviceScaleFactor: SCALE,
    // The frame is the product's own dark surface. Pinned rather than inherited
    // so the capture does not depend on the machine running it.
    colorScheme: "dark",
    reducedMotion: "reduce",
  });

  await page.goto(`${origin}/impact`, { waitUntil: "networkidle" });
  await page.waitForSelector(".hero");
  await page.waitForSelector(".contribution-band");

  // The build must be the one a judge is shown. A placeholder build renders
  // `<dataset-name>` and would produce a poster of invented values, which is the
  // one failure this whole repository exists to make impossible.
  const subject = await page.textContent(".hero h1, .hero__title, .hero");
  if (!subject?.includes("game_events")) {
    throw new Error(
      `The built cockpit is not rendering the golden subject. Found: ${JSON.stringify(subject?.slice(0, 80))}. ` +
        "Run `npm run build` (committed mode is the default) before capturing.",
    );
  }

  const clip = await page.evaluate(
    ({ padTop, padBottom, gap }) => {
      // The frame is the step rail, the subject, and who contributed what. The
      // rail is the orientation the poster used to get from the status strip;
      // the contribution band is where the per-fact attribution now lives, and
      // it is the last thing that belongs in an opening image.
      const spineEl = document.querySelector(".spine");
      const bandEl = document.querySelector(".contribution-band");
      if (spineEl === null || bandEl === null) {
        throw new Error(
          "The poster crop is anchored on .spine and .contribution-band and one of them is missing. " +
            "The cockpit layout changed; re-anchor the crop rather than capturing a frame of whatever is there.",
        );
      }
      const spine = spineEl.getBoundingClientRect();
      const band = bandEl.getBoundingClientRect();
      const next = bandEl.nextElementSibling?.getBoundingClientRect() ?? null;

      const top = Math.round(spine.y - padTop);
      const padded = band.y + band.height + padBottom;
      // Whichever is higher: the padded hero edge, or a hairline above whatever
      // comes next. Half a row of the following element in frame is the failure
      // this clamp exists to prevent.
      const bottom = Math.round(next ? Math.min(padded, next.y - gap) : padded);
      return {
        x: 0,
        y: top,
        width: Math.round(document.documentElement.clientWidth),
        height: bottom - top,
        clampedToNext: next ? padded > next.y - gap : false,
      };
    },
    { padTop: PAD_TOP, padBottom: PAD_BOTTOM, gap: NEXT_ELEMENT_GAP },
  );

  if (Math.abs(clip.height - EXPECTED_HEIGHT) > HEIGHT_TOLERANCE) {
    throw new Error(
      `Measured band height ${clip.height} is more than ${HEIGHT_TOLERANCE}px from the approved ${EXPECTED_HEIGHT}. ` +
        "The frame has changed shape, so the approved caption and alt text may no longer describe it. Re-review, then update EXPECTED_HEIGHT.",
    );
  }

  const id = `readme-poster-impact-${WIDTH * SCALE}x${clip.height * SCALE}`;
  const outDir = join(root, "assets", "exports", id);
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${id}.png`);
  const { clampedToNext, ...rect } = clip;
  await page.screenshot({ path: file, clip: rect });

  const bytes = readFileSync(file);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const record = {
    id,
    capturedFromCommit: commit,
    route: "/impact",
    datasetKey: "nested",
    sourceMode: "committed",
    cssViewport: { width: WIDTH, height: clip.height },
    deviceScaleFactor: SCALE,
    export: { width: WIDTH * SCALE, height: clip.height * SCALE, format: "png" },
    colorScheme: "dark",
    clampedToNextElement: clampedToNext,
    sha256,
    bytes: bytes.length,
    generationMethod: "npm run build && node scripts/capture-readme-assets.mjs",
  };
  writeFileSync(join(outDir, "capture.json"), `${JSON.stringify(record, null, 2)}\n`);

  console.log(JSON.stringify(record, null, 2));
  console.log(`\nWrote ${file}`);
  await page.close();

  await captureWalkthrough();
} finally {
  await browser.close();
  await new Promise((closed) => server.close(closed));
}

/**
 * The product walkthrough: Impact, one click, Change plan.
 *
 * Three key frames with explicit durations rather than a recorded video. The
 * surface is static between interactions, so a frame-and-duration timeline is
 * both smaller and exactly reproducible -- a video capture would encode whatever
 * the machine's frame scheduler happened to do, and two runs would never produce
 * the same bytes.
 *
 * Captured under `reducedMotion: reduce`. A GIF cannot read the viewer's
 * `prefers-reduced-motion`, so the choice is which single behaviour to ship, and
 * the calm one is the only defensible default: a viewer who needs reduced motion
 * cannot opt out of what is baked in. This is recorded as a limitation on the
 * asset rather than left implicit.
 *
 * The GIF does not loop. It ends on the Change plan state and stays there, which
 * is the point -- the closing frame is the claim, and a loop would pull it away
 * from a reader mid-sentence to replay an opening they have already seen.
 */
async function captureWalkthrough() {
  const id = `readme-walkthrough-${GIF_WIDTH}x${GIF_HEIGHT}`;
  const outDir = join(root, "assets", "exports", id);
  mkdirSync(outDir, { recursive: true });

  const page = await browser.newPage({
    viewport: { width: GIF_WIDTH, height: GIF_HEIGHT },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });

  await page.goto(`${origin}/impact`, { waitUntil: "networkidle" });
  await page.waitForSelector(".coordinate");
  await page.waitForTimeout(400);

  const frames = [];
  const shoot = async (name) => {
    const path = join(outDir, `frame-${name}.png`);
    await page.screenshot({ path });
    frames.push(path);
    return path;
  };

  await shoot("open");

  const cta = page
    .getByRole("link", { name: /Continue to change plan/i })
    .or(page.getByRole("button", { name: /Continue to change plan/i }))
    .first();
  // Hover, not a drawn cursor. The button's own hover state is the product
  // saying it is about to be used; a painted pointer ring would be decoration
  // asserting an interaction the frame does not contain.
  await cta.hover();
  await page.waitForTimeout(250);
  await shoot("press");

  await cta.click();
  await page.waitForSelector(".plan-panel");
  await page.waitForTimeout(700);
  await shoot("plan");

  /*
    Everything the closing frame has to carry, checked rather than trusted. The
    four strings below are the walkthrough's entire claim: without them the GIF
    shows a tab change. Asserted on rendered text, and asserted to be inside the
    viewport, because content scrolled below the fold is absent from the frame
    however present it is in the DOM.
  */
  const closing = await page.evaluate(() => {
    const text = document.body.textContent ?? "";
    const panels = Array.from(document.querySelectorAll(".plan-panel"));
    // The named residuals moved from the sticky rail to the scope strip when the
    // decision became a band. Same question as before: is the list complete in
    // frame, or is it scrolling and therefore showing a partial set?
    const gaps = document.querySelector(".scope__residuals");
    return {
      refusal: text.includes("refuse to add the dbt quality check"),
      repositoryPath: text.includes("dbt/models/curated/game_events.sql"),
      pinnedRevision: text.includes("59fa295c51fc23466f3a71542f8bf3d1335daa83"),
      proposedAction: text.includes("Add a dbt quality check for game_events"),
      // Coverage is asserted once, in the scope strip, and Scope B is the cell
      // that carries it. The old six-cell strip said "Not established"; the strip
      // names the scope first, so the string to look for changed with it.
      coverageVisible: (document.querySelector(".scope-strip")?.textContent ?? "").includes("Completeness not established"),
      panelsInViewport: panels.length > 0 && panels.every((p) => p.getBoundingClientRect().bottom <= window.innerHeight),
      gapsClipped: gaps ? gaps.scrollHeight > gaps.clientHeight + 1 : null,
      scrollY: window.scrollY,
    };
  });

  const missing = Object.entries(closing)
    .filter(([key, value]) => key !== "scrollY" && key !== "gapsClipped" && value !== true)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`The closing frame does not carry its claim. Missing or out of view: ${missing.join(", ")}.`);
  }
  if (closing.scrollY !== 0) {
    throw new Error(`The sequence scrolled (scrollY=${closing.scrollY}). The viewport must hold both states without moving the page.`);
  }
  if (closing.gapsClipped) {
    throw new Error(
      "The stated-gaps list is in its compact layout at this width, so the closing frame would show an incomplete gap list. " +
        `That layout is valid for the application; it is unsuitable for this frame. Raise GIF_WIDTH past the ${GIF_WIDTH}px media-query boundary rather than changing the list's cap, which exists to keep the primary action above the fold.`,
    );
  }

  const listPath = join(outDir, "frames.txt");
  const list = GIF_TIMELINE.map((f, i) => `file '${frames[i]}'\nduration ${f.seconds}`).join("\n");
  // The concat demuxer ignores the final entry's duration, so the last frame is
  // repeated. Without it the closing state flashes for one frame interval and
  // the GIF ends on the thing it exists to show, unread.
  writeFileSync(listPath, `${list}\nfile '${frames[frames.length - 1]}'\n`);

  const gif = join(outDir, `${id}.gif`);
  const palette = join(outDir, "palette.png");
  const filters = "scale=iw:ih:flags=lanczos";
  run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-vf", `${filters},palettegen=max_colors=192:stats_mode=diff`, palette]);
  run("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-i", palette,
    "-lavfi", `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    // -1 is "play once and hold". 0 would loop forever.
    //
    // No `-final_delay`. A non-looping GIF already holds its last frame for as
    // long as the reader looks at it, so a trailing delay adds nothing visible
    // and everything to the reported duration: 500 centiseconds took an 8.0s
    // walkthrough to a 13.0s file, outside the runtime this sequence was paced
    // for. Measured with ffprobe, not assumed.
    "-loop", "-1", gif,
  ]);

  // The poster frame is the GIF's own first frame at the GIF's own viewport, a
  // separate export with its own hash. The Impact poster is a different crop for
  // a different job, and reusing it would put a frame on screen that does not
  // match the one playback starts from.
  const posterId = `${id}-poster`;
  const posterDir = join(root, "assets", "exports", posterId);
  mkdirSync(posterDir, { recursive: true });
  const posterFile = join(posterDir, `${posterId}.png`);
  writeFileSync(posterFile, readFileSync(frames[0]));

  const digest = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
  const gifBytes = readFileSync(gif);
  const walkthrough = {
    id,
    capturedFromCommit: commit,
    sequence: GIF_TIMELINE.map((f) => ({ ...f })),
    totalSeconds: GIF_TIMELINE.reduce((sum, f) => sum + f.seconds, 0),
    loops: false,
    routes: ["/impact", "/change-plan"],
    interaction: "one click on the primary action; no scrolling, no resize",
    datasetKey: "nested",
    sourceMode: "committed",
    cssViewport: { width: GIF_WIDTH, height: GIF_HEIGHT },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
    closingFrameCarries: closing,
    export: { width: GIF_WIDTH, height: GIF_HEIGHT, format: "gif", bytes: gifBytes.length },
    sha256: digest(gif),
    poster: { id: posterId, path: `assets/exports/${posterId}/${posterId}.png`, sha256: digest(posterFile) },
    generationMethod: "npm run build && node scripts/capture-readme-assets.mjs",
  };
  writeFileSync(join(outDir, "capture.json"), `${JSON.stringify(walkthrough, null, 2)}\n`);
  writeFileSync(join(posterDir, "capture.json"), `${JSON.stringify({ ...walkthrough.poster, capturedFromCommit: commit, derivedFrom: id, frame: "open", cssViewport: { width: GIF_WIDTH, height: GIF_HEIGHT }, generationMethod: walkthrough.generationMethod }, null, 2)}\n`);

  // The intermediates go. `frames.txt` embeds absolute paths from whichever
  // machine ran the capture, so committing it would put one developer's home
  // directory in the registry; the frames and the palette are regenerable and
  // only the GIF and its poster are the asset.
  for (const path of [...frames, listPath, palette]) rmSync(path, { force: true });

  console.log(`\n${JSON.stringify(walkthrough, null, 2)}`);
  console.log(`\nWrote ${gif} (${(gifBytes.length / 1024 / 1024).toFixed(2)} MB)`);
  await page.close();
}

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
}
