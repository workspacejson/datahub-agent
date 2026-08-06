import { expect, test } from "@playwright/test";
import { COMMITTED_ORIGIN } from "../playwright.config";

/**
 * Popovers must paint above whatever they open over.
 *
 * The defect this was written for was a sticky six-cell status bar carrying
 * `z-index: 5`, the only z-index in the stylesheet. Both popovers portal to
 * `document.body`, so they are the last elements in the document — but painting
 * order does not save them: a positioned element with a z-index wins over a
 * later positioned element whose z-index resolves to `auto`. The header's
 * definition panel opened straight into that band and was rendered with the
 * status cells drawn on top of its text.
 *
 * The reduction pass cut the bar. The rule it exposed did not go with it: the
 * failure returns the moment anything on the page takes a z-index, and the fix
 * — Radix copying the panel's computed z-index onto the wrapper it positions —
 * is undocumented by us and load-bearing. So both halves are still asserted,
 * against the two things that remain true without the bar: the panel is the top
 * element everywhere inside itself, and the wrapper carries `--layer-popover`
 * rather than `auto`.
 *
 * The existing spacing spec did not catch the original and could not have. It
 * asserts `toBeVisible()` and reads `boundingBox()`, and both pass on a fully
 * occluded element. Neither Playwright visibility nor axe models paint order,
 * so this asks the only question that distinguishes the states, the same one a
 * reader's eye asks: at a point inside the panel, which element is on top?
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
 * Sampled rather than centre-only because the occlusion was partial: the bar
 * covered the panel's upper band while its lower half stayed readable, so a
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
  test(`the term definition paints above the content it covers at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${COMMITTED_ORIGIN}/impact`);

    const trigger = page.getByRole("button", { name: /joining them/ });
    await trigger.scrollIntoViewIfNeeded();
    await expect(trigger).toBeVisible();
    await trigger.click();

    const panel = page.locator(".term-def__panel").first();
    await expect(panel).toBeVisible();

    const box = await panel.boundingBox();
    expect(box).not.toBeNull();

    /*
      The occluder is injected rather than found.

      The first version of this probe looked for whatever page content happened
      to sit under the panel. That was measured and rejected: with a z-index
      deliberately planted on `.route-slot`, the probe went red at 1280x800 and
      *green* at 1440x900, because the panel's collision flip put it clear of the
      offending element at the wider viewport. A guard that reports pass on a
      page that is actually broken is worse than no guard, and it is the same
      class of hole the sticky-bar defect lived in.

      So the test supplies the thing that must lose: a fixed overlay laid exactly
      over the panel's own box, at the z-index the sticky bar used to carry. The
      geometry is no longer luck, the historical defect is reproduced exactly,
      and the probe cannot be vacuous.
    */
    const overlay = (zIndex: number) => page.evaluate(({ rect, zIndex: z }) => {
      document.querySelector("#stacking-probe")?.remove();
      const element = document.createElement("div");
      element.id = "stacking-probe";
      element.style.cssText = `position:fixed;left:${rect.x}px;top:${rect.y}px;`
        + `width:${rect.width}px;height:${rect.height}px;z-index:${z};background:transparent`;
      document.body.append(element);
    }, { rect: box!, zIndex });

    const occludedPoints = () => page.evaluate((points) => {
      const found: string[] = [];
      for (const point of points) {
        const top = document.elementFromPoint(point.x, point.y);
        if (!top?.closest(".term-def__panel")) {
          found.push(`(${point.x},${point.y}) -> ${top?.id || top?.className || top?.tagName || "nothing"}`);
        }
      }
      return found;
    }, probes(box!));

    // The rule: a page element that takes a z-index does not get to paint over
    // an open popover. 5 is what the sticky outcome bar carried.
    await overlay(5);
    expect(await occludedPoints()).toEqual([]);

    /*
      And the probe can still go red. Both scans above pass trivially on a page
      where nothing can ever be on top, which is exactly how the previous version
      passed at 1440x900 while broken, so the detector is exercised in the same
      run rather than trusted.
    */
    await overlay(9999);
    expect(
      await occludedPoints(),
      "the probe must be able to detect an occluder, or the assertion above proves nothing",
    ).not.toEqual([]);

    await page.evaluate(() => document.querySelector("#stacking-probe")?.remove());
  });

  test(`the hero proof popover wrapper carries the popover layer at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    /*
      The sibling primitive, which shares the portal and the same defect.

      This asserts the ordering rather than the paint. An earlier draft ran the
      same `elementFromPoint` probe behind an overlap check and skipped on every
      engine at both viewports: twelve green ticks over an assertion that never
      executed, which reads as coverage of a rule nothing tested.

      Read off the wrapper, not the panel, because the wrapper is what stacks.
      That is also the assertion that fails if Radix ever stops copying the
      panel's computed z-index onto it. The expected value is read from the token
      rather than hardcoded, so renumbering the layer scale cannot leave this
      passing against a stale number.
    */
    await page.setViewportSize(viewport);
    await page.goto(`${COMMITTED_ORIGIN}/impact`);

    const trigger = page.getByRole("button", { name: /View dataset identity/ });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.locator(".proof-popover__panel").first()).toBeVisible();

    const layers = await page.evaluate(() => {
      const wrapper = document.querySelector("[data-radix-popper-content-wrapper]");
      return {
        wrapper: wrapper ? window.getComputedStyle(wrapper).zIndex : null,
        token: window.getComputedStyle(document.documentElement).getPropertyValue("--layer-popover").trim(),
      };
    });

    // `auto` is the failure this whole spec exists for, and it parses to NaN
    // rather than to something comparable, so it is rejected by name first.
    expect(layers.wrapper).not.toBe("auto");
    expect(layers.token).not.toBe("");
    expect(Number(layers.wrapper)).toBe(Number(layers.token));
  });
}
