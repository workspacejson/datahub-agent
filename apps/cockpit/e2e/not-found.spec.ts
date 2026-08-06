import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { BUILT_ORIGIN } from "../playwright.config";

/**
 * The surface a reader reaches by asking for a path that has no route.
 *
 * Run against the built artifact rather than a dev server, because this is a
 * routing behaviour and routing is where the two differ: Vercel rewrites every
 * unmatched path to `index.html`, so the refusal is the app's to render, and the
 * only way to check that the rewrite and the app agree is to serve the build.
 * `dataset-default.spec.ts` exists for the same reason.
 *
 * The fold assertions are the ones that matter here. A reader on this page has
 * already lost their way once; a return control that needs scrolling to find is
 * the broken state this page exists to prevent, and it is invisible to axe --
 * both first-frame failures on `main` were.
 */
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1280, height: 800 }];

/** Clearance the return must keep below itself, matching `first-frame.spec.ts`. */
const FOLD_HEADROOM = 48;

/** Paths with no route: a typo, a deeper path, and a link with a stale suffix. */
const UNROUTED = ["/recipts", "/impact/2", "/receipts/section/provenance"];

test("an unrouted path is answered with a 404 status, not a 200", async ({ page }) => {
  /*
    The status, which no amount of rendering can substitute for. A 200 on a path
    that does not exist tells every non-human reader -- a crawler, a link
    checker, a monitor, a browser's history heuristics -- that the page is fine.

    This is what narrowing `vercel.json`'s rewrite to the three real routes buys,
    and it is only observable against a server applying that file: `vite preview`
    answered every path with `index.html` at 200.
  */
  const response = await page.goto(`${BUILT_ORIGIN}/recipts`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("404");
});

test("a real route is answered with a 200", async ({ page }) => {
  // The positive control for the status, in the shape the defect would take: a
  // narrowed rewrite that misses a route 404s a page that exists.
  for (const path of ["/", "/impact", "/change-plan", "/receipts"]) {
    const response = await page.goto(`${BUILT_ORIGIN}${path}`);
    expect(response?.status(), `${path} is a real route`).toBe(200);
  }
});

test("a trailing slash is redirected rather than refused", async ({ page }) => {
  const response = await page.goto(`${BUILT_ORIGIN}/receipts/`);
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(`${BUILT_ORIGIN}/receipts`);
});

test("the refusal and the way out survive without the bundle", async ({ browser }, testInfo) => {
  /*
    The prerendered document, on its own terms.

    `404.html` carries `NotFoundView` rendered to static markup at build time,
    so the claim and the return are in the HTML rather than in a script. A reader
    who has already landed on a path that does not exist is the last reader who
    should need a working bundle to get out of it, and on a deployment where the
    bundle fails to load this page is the only one that still works.

    The path is absent here and present with JavaScript on. That is the one
    difference, and it is a true subset: one document answers every unmatched
    path, so the static markup states the absence instead of naming a path it
    cannot know.
  */
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORTS[0]);

  const response = await page.goto(`${BUILT_ORIGIN}/recipts`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("404");
  await expect(page.getByText("No route is bound to this path.")).toBeVisible();

  const back = page.getByRole("link", { name: "Go to the impact review" });
  await expect(back).toBeVisible();
  // The scriptless frame, kept as an artifact: this is the one rendering of this
  // page that no test of the React tree can stand in for.
  await page.screenshot({ path: testInfo.outputPath("not-found-no-script.png") });

  await back.click();
  await expect(page).toHaveURL(`${BUILT_ORIGIN}/`);

  await context.close();
});

for (const viewport of VIEWPORTS) {
  test(`an unrouted path states the refusal at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${BUILT_ORIGIN}/recipts`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("404");
    await expect(page.getByText("No route is bound to")).toBeVisible();
    // None of the review. A navigable sequence on a path that selects no subject
    // is the substitution this replaced, wearing a 404 above it.
    await expect(page.getByRole("navigation", { name: "Review sequence" })).toHaveCount(0);
  });

  test(`the way back is in the first frame at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${BUILT_ORIGIN}/recipts`);

    const back = page.getByRole("link", { name: "Go to the impact review" });
    await expect(back).toBeVisible();

    const box = await back.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    // With headroom, not merely on screen. Same number as the decision band's,
    // for the same reason: a control that clears by a pixel is a control the
    // next copy edit pushes under the fold with nothing failing.
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - FOLD_HEADROOM);

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test(`the refusal contains its own content at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    // The longest path this surface can be handed: the statement clamps it, and
    // the clamp is what keeps a pasted URL from bursting the frame.
    await page.goto(`${BUILT_ORIGIN}/${"segment/".repeat(60)}`);

    const overflowing = await page.evaluate(() => {
      const offenders: string[] = [];
      for (const element of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
        const overflowX = getComputedStyle(element).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") continue;
        if (element.clientWidth === 0) continue;
        if (element.scrollWidth > element.clientWidth + 1) {
          offenders.push(`${element.tagName.toLowerCase()}.${element.className || "(no class)"} ` +
            `content ${element.scrollWidth}px in ${element.clientWidth}px`);
        }
      }
      return offenders;
    });
    expect(overflowing).toEqual([]);

    const pageOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(pageOverflow).toBeLessThanOrEqual(1);

    // And the control is still where the fold check found it, with the worst
    // string this page can be given already on screen.
    const box = await page.getByRole("link", { name: "Go to the impact review" }).boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - FOLD_HEADROOM);
  });

  test(`the refusal is accessible at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(`${BUILT_ORIGIN}/recipts`);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`not-found-${viewport.width}x${viewport.height}.png`) });
  });
}

test("the refusal and its return fit a phone frame at 390x844", async ({ page }, testInfo) => {
  /*
    The gate and the statement sit on one row down to the wrap point and stack
    below it. Unlike the impact route, this page has no band it can afford to
    push under the fold: the whole surface is one statement and one control, so
    both are asserted in frame here rather than traded away for a narrow column.
  */
  const viewport = { width: 390, height: 844 };
  await page.setViewportSize(viewport);
  await page.goto(`${BUILT_ORIGIN}/recipts`);

  for (const locator of [
    page.getByRole("heading", { level: 1 }),
    page.getByText("No route is bound to"),
    page.getByRole("link", { name: "Go to the impact review" }),
  ]) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  }

  const pageOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("not-found-390x844.png") });
});

for (const path of UNROUTED) {
  test(`the return lands on the review from ${path}`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[0]);
    await page.goto(`${BUILT_ORIGIN}${path}`);

    await page.getByRole("link", { name: "Go to the impact review" }).click();

    await expect(page).toHaveURL(`${BUILT_ORIGIN}/`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("game_events");
    await expect(page.getByRole("navigation", { name: "Review sequence" })).toBeVisible();
    // The address bar no longer asserts a path the app declined. Leaving it
    // would make a reload undo the return.
    await expect(page.getByRole("heading", { name: "404" })).toHaveCount(0);
  });
}

test("a real route still renders the review", async ({ page }) => {
  /*
    The positive control on the document, beside the one on the status above.
    Every assertion in this file passes on a build that refuses everything, and a
    404 that swallows the product is a worse failure than the silent substitution
    it replaced.
  */
  await page.setViewportSize(VIEWPORTS[0]);
  for (const path of ["/", "/impact", "/change-plan", "/receipts"]) {
    await page.goto(`${BUILT_ORIGIN}${path}`);
    await expect(page.getByRole("heading", { level: 1 }), `${path} renders the review`).toHaveText("game_events");
  }
});
