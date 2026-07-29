import { expect, test } from "@playwright/test";
import { FIXTURE_ORIGIN } from "../playwright.config";

/**
 * The two first-frame failures, asserted mechanically.
 *
 * Both were live on `main` at `8ecb774` while this suite was green, because
 * neither is an accessibility violation and neither moves an element out of the
 * DOM. Axe cannot see them, so axe alone was insufficient:
 *
 *   containment  `.identity-grid` was `repeat(3, 1fr)`, which is
 *                `minmax(auto, 1fr)` per column, so a column could not shrink
 *                below an unbreakable URN. 953px of card rendered inside a 754px
 *                container and the third card, the workspace.json claim, sat
 *                outside the panel at 144px wide.
 *   next action  the primary CTA sat at y=1378 on a 1533px page: 478px below a
 *                1440x900 fold, 578px below a 1280x800 one. HAC-228 shows a cold
 *                reader the first frame for five seconds and forbids scrolling.
 *
 * These run against the fixture origin. In placeholder mode the identity string
 * is `<dataset-name>`, which fits, so the regression is only reproducible on the
 * evidence a judge is actually shown.
 */
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1280, height: 800 }];

for (const viewport of VIEWPORTS) {
  test(`first frame contains its own content at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${FIXTURE_ORIGIN}/?view=impact`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const overflowing = await page.evaluate(() => {
      const offenders: string[] = [];
      for (const element of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
        // An element that declares itself scrollable on x is allowed to be
        // wider than its box. Everything else overflowing is content a reader
        // silently loses: `visible` spills outside the panel, `hidden` clips.
        const overflowX = getComputedStyle(element).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") continue;
        if (element.scrollWidth > element.clientWidth + 1) {
          offenders.push(`${element.tagName.toLowerCase()}.${element.className || "(no class)"} ` +
            `content ${element.scrollWidth}px in ${element.clientWidth}px`);
        }
      }
      return offenders;
    });
    expect(overflowing).toEqual([]);

    // No page-level horizontal scroll either. This one never fired for the
    // original defect, and is kept because it is a different failure.
    const pageOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(pageOverflow).toBeLessThanOrEqual(1);
  });

  test(`the next action is readable without scrolling at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${FIXTURE_ORIGIN}/?view=impact`);

    const cta = page.getByRole("button", { name: "Review changed plan" });
    await expect(cta).toBeVisible();

    const box = await cta.boundingBox();
    expect(box).not.toBeNull();
    // Fully inside the first frame, not merely intersecting it. A button whose
    // label is half cut off is not an answer to "what is the next action".
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

    // The frame must not buy the CTA's place by dropping what the reader needs
    // to judge it. All four have to be in the same unscrolled frame.
    for (const locator of [
      page.getByRole("heading", { level: 1 }),                       // dataset identity
      page.getByLabel("Evidence state"),                             // epistemic state
      page.getByLabel("Coverage of this review"),                    // thesis: how much is known
      page.getByLabel("Stated gaps and next action"),                // material gaps
    ]) {
      const region = await locator.first().boundingBox();
      expect(region).not.toBeNull();
      expect(region!.y).toBeLessThan(viewport.height);
    }

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
}

test("the changed-plan destination shows the real evidence-backed delta", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto(`${FIXTURE_ORIGIN}/?view=impact`);
  await page.getByRole("button", { name: "Review changed plan" }).click();

  // Not "renders an empty list correctly". The bundle carries typed deltas, and
  // every one of them must reach the surface with the evidence behind it.
  const deltas = page.locator(".delta");
  await expect(deltas).not.toHaveCount(0);
  await expect(page.getByText(/No plan comparison available/)).toHaveCount(0);
  await expect(deltas.first().locator(".evidence-refs")).toContainText("evidence.");

  // Both plans, side by side. The comparison is the argument; a delta list alone
  // shows the difference while hiding the two things that differ.
  await expect(page.getByText("Declared context alone")).toBeVisible();
  await expect(page.getByText("Declared context plus repository evidence")).toBeVisible();
});
