#!/usr/bin/env node
/**
 * Export the authored README canvases from their checked-in `.dc.html` sources.
 *
 * The sibling script `capture-readme-assets.mjs` captures the *running product*:
 * it builds the cockpit and photographs it. This one is for the *authored*
 * diagrams -- the hero, the architecture boundary, the two quantitative figures
 * and the feedback synthesis. They are drawings, not screenshots, so their
 * source of record is an editable HTML canvas rather than a route.
 *
 * Until this script existed, that distinction was where the registry's honesty
 * broke down. Every raster record said "no editable source is checked in, so
 * this export cannot be regenerated from this repository", and for the authored
 * diagrams that was true twice over: the canvas lived in a designer's Downloads
 * folder, and rendering it needed a font CDN. Correcting a typo meant reopening
 * a tool nothing in version control could name. The `.dc.html` file is now the
 * editable source, this script is the generation method, and the PNG is the
 * governed display export.
 *
 *   node scripts/export-authored-readme-assets.mjs
 *   node scripts/export-authored-readme-assets.mjs --check   # export nothing, verify digests
 *
 * The gates below are the point of the script, not decoration around it. Each
 * one closes a way an export can silently stop describing its source.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 2x, matching every other raster in the registry.
 *
 * GitHub scales a README image down to the content column, so a 1x export of a
 * 1400px canvas is resampled to roughly 60% and the 12px mono labels that carry
 * the numbers stop being readable. The asset id names the CSS canvas; the file
 * is twice that in each direction, and both are recorded.
 */
const DEVICE_SCALE_FACTOR = 2;

/**
 * One entry per registry record. `css` is the canvas the source declares, and
 * it is asserted against the rendered box rather than assumed -- a layout change
 * that reflows the drawing must fail here rather than quietly produce a
 * differently shaped image under an approved caption and alt text.
 *
 * `heightFromContent` marks the one canvas whose root element sets no height.
 * Its height is whatever the content comes to, and it comes to a fractional
 * number of CSS pixels, so no declared height can be asserted against it. The
 * governed dimension there is `png`, which is read out of the produced file.
 *
 * `png` is the export's real pixel size, and it is not `css * scale`. That
 * assumption is what this script shipped with and it was wrong by two pixels on
 * the one fractional canvas: the CSS box rounds down to 829 and the device
 * pixels round up to 1660. A provenance file that states a dimension it derived
 * rather than read is the same defect as a diagram that states a number nobody
 * measured, so both the assertion and the record now come from the PNG header.
 */
const ASSETS = [
  { id: "readme-tally-hero-1280x440", css: { width: 1280, height: 440 }, png: { width: 2560, height: 880 } },
  { id: "readme-cockpit-architecture-boundary-1800x1100", css: { width: 1800, height: 1100 }, png: { width: 3600, height: 2200 } },
  { id: "readme-hac-150-paired-evaluation-1400x620", css: { width: 1400, height: 620 }, png: { width: 2800, height: 1240 } },
  { id: "readme-node-accounting-1200x780", css: { width: 1200 }, heightFromContent: true, png: { width: 2400, height: 1660 } },
  { id: "readme-datahub-feedback-synthesis-1400x1110", css: { width: 1400, height: 1110 }, png: { width: 2800, height: 2220 } },
];

/**
 * Width and height straight out of the PNG's IHDR chunk, which is fixed-offset
 * and always first. Eight bytes of parsing rather than an image dependency.
 */
function pngDimensions(bytes) {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Copy that the drawing exists to state, asserted on the rendered page.
 *
 * A diagram is only evidence while its words match the finding it illustrates.
 * These two were corrected -- "context envelope only" because the DataHub-only
 * arm varies the context envelope rather than the context, and "proof-corpus
 * node" because the accounting covers the pinned proof corpus rather than dbt in
 * general -- and a silent revert would put a wrong claim back on the README
 * under a caption that still reads as checked. Asserted on rendered text, so a
 * correction hidden behind `display:none` fails too.
 */
const REQUIRED_TEXT = {
  "readme-hac-150-paired-evaluation-1400x620": {
    present: ["context envelope only variable"],
    absent: ["context only variable"],
  },
  "readme-node-accounting-1200x780": {
    present: ["Every proof-corpus node is accounted for"],
    absent: ["Every dbt node is accounted for"],
  },
};

const checkOnly = process.argv.includes("--check");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Chromium's own version, not the wrapper's.
 *
 * `playwright-core`'s package version tracks the Node API; the bytes of a PNG
 * come out of the browser. Recording the wrapper would name something that
 * cannot change a pixel while leaving the thing that can unrecorded.
 */
const browser = await chromium.launch();
const runtime = `Chromium ${browser.version()} via playwright-core ${
  JSON.parse(readFileSync(join(root, "node_modules", "playwright-core", "package.json"), "utf8")).version
}`;

const results = [];
let failures = 0;

try {
  for (const asset of ASSETS) {
    const sourcePath = join(root, "assets", "source", asset.id, `${asset.id}.dc.html`);
    const exportPath = join(root, "assets", "exports", asset.id, `${asset.id}.png`);

    // A missing source is the failure this script exists to make loud. Silently
    // skipping would leave a registered export with an `editableSource` naming a
    // file that is not there, which reads as provenance and is not.
    if (!existsSync(sourcePath)) {
      console.error(`FAIL ${asset.id}: no editable source at ${relative(root, sourcePath)}`);
      failures += 1;
      continue;
    }

    const page = await browser.newPage({
      // The viewport only has to hold the canvas; the capture is clipped to the
      // canvas element itself. For the content-sized canvas there is no declared
      // height to use, so the expected export height in CSS pixels serves.
      viewport: {
        width: asset.css.width,
        height: asset.css.height ?? Math.ceil(asset.png.height / DEVICE_SCALE_FACTOR),
      },
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      // Pinned rather than inherited. These canvases are drawn on the product's
      // dark surface, and the token files carry a light-mode block; a capture
      // that took the host machine's preference would produce a different
      // picture on a different laptop.
      colorScheme: "dark",
      reducedMotion: "reduce",
    });

    /*
      No network, enforced two ways.

      The route aborts anything that is not a local file, so a remote font or
      script cannot reach the render even if one is reintroduced. The listener
      records the attempt, so the run fails loudly rather than quietly producing
      a fallback-typeset image that looks fine until it is compared. Blocking
      without reporting is how a font CDN outage becomes a silently reflowed
      diagram.
    */
    const remote = [];
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("file:") || url.startsWith("data:") || url.startsWith("about:")) return route.continue();
      remote.push(url);
      return route.abort();
    });
    page.on("request", (request) => {
      const url = request.url();
      if (!url.startsWith("file:") && !url.startsWith("data:") && !url.startsWith("about:") && !remote.includes(url)) {
        remote.push(url);
      }
    });

    await page.goto(pathToFileURL(sourcePath).href, { waitUntil: "load" });
    // Faces are declared `font-display: block`, so this resolving is what
    // guarantees the capture is not racing a fallback metric.
    await page.evaluate(() => document.fonts.ready);

    const canvas = page.locator("[data-screen-label]").first();
    const box = await canvas.boundingBox();

    const problems = [];
    if (remote.length > 0) {
      problems.push(`loads ${remote.length} network resource(s): ${[...new Set(remote)].join(", ")}`);
    }
    if (Math.round(box.width) !== asset.css.width) {
      problems.push(`rendered ${Math.round(box.width)} CSS px wide, expected ${asset.css.width}`);
    }
    if (asset.css.height !== undefined && Math.round(box.height) !== asset.css.height) {
      problems.push(`rendered ${Math.round(box.height)} CSS px tall, expected ${asset.css.height}`);
    }

    const required = REQUIRED_TEXT[asset.id];
    if (required) {
      const rendered = await canvas.innerText();
      for (const phrase of required.present) {
        if (!rendered.includes(phrase)) problems.push(`rendered text is missing ${JSON.stringify(phrase)}`);
      }
      for (const phrase of required.absent) {
        if (rendered.includes(phrase)) problems.push(`rendered text still contains the superseded ${JSON.stringify(phrase)}`);
      }
    }

    if (problems.length > 0) {
      console.error(`FAIL ${asset.id}:\n  - ${problems.join("\n  - ")}`);
      failures += 1;
      await page.close();
      continue;
    }

    const png = await canvas.screenshot({ scale: "device" });
    const pixels = pngDimensions(png);
    if (pixels.width !== asset.png.width || pixels.height !== asset.png.height) {
      console.error(
        `FAIL ${asset.id}:\n  - exported ${pixels.width}x${pixels.height} px, expected ${asset.png.width}x${asset.png.height}. ` +
          "The frame has changed shape, so the approved caption and alt text may no longer describe it. Re-review, then update the expected size.",
      );
      failures += 1;
      await page.close();
      continue;
    }

    const sourceBytes = readFileSync(sourcePath);

    const record = {
      id: asset.id,
      source: {
        path: relative(root, sourcePath),
        sha256: sha256(sourceBytes),
        bytes: sourceBytes.length,
      },
      export: {
        path: relative(root, exportPath),
        sha256: sha256(png),
        bytes: png.length,
        format: "png",
        width: pixels.width,
        height: pixels.height,
      },
      cssBox: { width: box.width, height: box.height },
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      colorScheme: "dark",
      heightSource: asset.heightFromContent ? "content" : "declared on the source canvas",
      networkResourcesLoaded: 0,
      generationCommand: "node scripts/export-authored-readme-assets.mjs",
      runtime,
      generatedAt: new Date().toISOString(),
    };

    if (checkOnly) {
      const current = existsSync(exportPath) ? sha256(readFileSync(exportPath)) : null;
      const same = current === record.export.sha256;
      console.log(`${same ? "ok  " : "DIFF"} ${asset.id}  rendered=${record.export.sha256.slice(0, 12)} onDisk=${(current ?? "absent").slice(0, 12)}`);
      if (!same) failures += 1;
    } else {
      mkdirSync(dirname(exportPath), { recursive: true });
      writeFileSync(exportPath, png);
      writeFileSync(join(dirname(exportPath), "capture.json"), `${JSON.stringify(record, null, 2)}\n`);
      console.log(`ok   ${asset.id}  ${record.export.width}x${record.export.height}  ${record.export.sha256.slice(0, 12)}  ${(png.length / 1024).toFixed(0)} KB`);
    }

    results.push(record);
    await page.close();
  }
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\n${failures} asset(s) failed.`);
  process.exit(1);
}

if (!checkOnly) {
  console.log(`\nWrote ${results.length} export(s) and their capture.json provenance.`);
  console.log("Re-run with --check to confirm the same source still produces the same bytes.");
}
