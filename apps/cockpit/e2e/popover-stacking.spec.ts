import { expect, test } from "@playwright/test";
import { COMMITTED_ORIGIN } from "../playwright.config";

/**
 * Popovers must paint above the sticky outcome bar.
 *
 * `.outcome-bar` is `position: sticky` with `z-index: 5`, the only z-index in
 * the stylesheet. Both popovers portal to `document.body`, so they are the last
 * elements in the document — but painting order does not save them: a
 * positioned element with `z-index: 5` wins over a later positioned element
 * whose z-index resolves to `auto`. The header's "repo-evidence artifact"
 * definition opens downward into exactly that band and was rendered with the
 * status cells drawn on top of its text.
 *
 * The existing spacing spec did not catch it, and could not have. It asserts
 * `toBeVisible()` and reads `boundingBox()`, and both pass on a fully occluded
 * element: the panel is in the DOM, has non-zero size, and is within the
 * viewport. Neither Playwright visibility nor axe models paint order. So this
 * asks the only question that distinguishes the states, the same one a reader's
 * eye asks: at a point inside the panel, which element is actually on top?
 *
 * Checked on all three engines the suite already runs, because stacking is
 * resolved by each engine's compositor rather than by shared layout code.
 */

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
];

/**
 * Points inside a box that should all hit the panel, inset from its own edges.
 *
 * Sampled rather than centre-only because the occlusion is partial: the outcome
 * bar covered the panel's upper band while its lower half stayed readable, so a
 * single centre probe would have reported the bug fixed while a judge still
 * could not read the first two lines.
 */
function probes(box: { x: number; y: number; width: number; height: number }) {
  const inset = 6;
  return [0.1, 0.3, 0.5, 0.7, 0.9].map((fraction) => ({
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + inset + (box.height - inset * 2) * fraction),
  }));
}

for (const viewport of VIEWPORTS) {
  test(`the term definition paints above the outcome bar at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${COMMITTED_ORIGIN}/impact`);

    const trigger = page.getByRole("button", { name: /repo-evidence artifact/ });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const panel = page.locator(".term-def__panel").first();
    await expect(panel).toBeVisible();

    const box = await panel.boundingBox();
    expect(box).not.toBeNull();

    // The bug reproduces only where the two actually overlap. If a future layout
    // moves the panel clear of the bar the guard would pass without testing
    // anything, so the overlap is asserted rather than assumed.
    const barBox = await page.locator(".outcome-bar").boundingBox();
    expect(barBox).not.toBeNull();
    const overlaps = box!.y < barBox!.y + barBox!.height && barBox!.y < box!.y + box!.height;
    expect(overlaps, "panel and outcome bar must overlap for this guard to mean anything").toBe(true);

    const occluded = await page.evaluate((points) => {
      const found: string[] = [];
      for (const point of points) {
        const top = document.elementFromPoint(point.x, point.y);
        if (!top?.closest(".term-def__panel")) {
          found.push(`(${point.x},${point.y}) -> ${top?.className || top?.tagName || "nothing"}`);
        }
      }
      return found;
    }, probes(box!));

    expect(occluded).toEqual([]);
  });

  test(`the hero proof popover is layered above the outcome bar at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    /*
      The sibling primitive, which shares the portal and the same defect but
      opens too far down the page to overlap the bar at either gate viewport.

      So this asserts the ordering rather than the paint. An earlier draft ran
      the same `elementFromPoint` probe behind an overlap check and skipped on
      every engine at both viewports: twelve green ticks over an assertion that
      never executed, which reads as coverage of a rule nothing tested. Ordering
      is the property the rule actually establishes, and unlike the paint it can
      be measured wherever the panel happens to land.

      Read off the wrapper, not the panel, because the wrapper is what stacks.
      That is also the assertion that fails if Radix ever stops copying the
      panel's computed z-index onto it, which is the load-bearing and entirely
      undocumented-by-us mechanism this fix depends on.
    */
    await page.setViewportSize(viewport);
    await page.goto(`${COMMITTED_ORIGIN}/impact`);

    const trigger = page.getByRole("button", { name: /View dataset identity/ });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.locator(".proof-popover__panel").first()).toBeVisible();

    const layers = await page.evaluate(() => {
      const wrapper = document.querySelector("[data-radix-popper-content-wrapper]");
      const bar = document.querySelector(".outcome-bar");
      return {
        wrapper: wrapper ? window.getComputedStyle(wrapper).zIndex : null,
        bar: bar ? window.getComputedStyle(bar).zIndex : null,
      };
    });

    // `auto` is the failure this whole spec exists for, and it parses to NaN
    // rather than to something comparable, so it is rejected by name first.
    expect(layers.wrapper).not.toBe("auto");
    expect(layers.bar).not.toBe("auto");
    expect(Number(layers.wrapper)).toBeGreaterThan(Number(layers.bar));
  });
}
