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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { preview } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cockpit = join(root, "apps", "cockpit");

/**
 * Capture width. Fixed, and the value matters.
 *
 * At 1280 the outcome bar keeps its six cells on one row and the hero keeps the
 * naive-join and resolved summaries side by side, which is the comparison the
 * whole frame exists to make. At 940 the bar reflows to 3x2 and the hero stacks:
 * the band grows from 3.4:1 to 1.6:1, the pairing is lost, and the image starts
 * dominating the README rather than opening it. Measured, both.
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
 */
const EXPECTED_HEIGHT = 380;
const HEIGHT_TOLERANCE = 40;

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
const server = await preview({
  root: cockpit,
  preview: { port: 4180, host: "127.0.0.1", strictPort: true },
  logLevel: "warn",
});
const origin = `http://127.0.0.1:4180`;

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
  await page.waitForSelector(".outcome-bar");
  await page.waitForSelector(".hero");

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
      const heroEl = document.querySelector(".hero");
      const bar = document.querySelector(".outcome-bar").getBoundingClientRect();
      const hero = heroEl.getBoundingClientRect();
      const next = heroEl.nextElementSibling?.getBoundingClientRect() ?? null;

      const top = Math.round(bar.y - padTop);
      const padded = hero.y + hero.height + padBottom;
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
} finally {
  await browser.close();
  await server.close();
}
