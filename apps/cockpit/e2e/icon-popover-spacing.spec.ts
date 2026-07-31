import { expect, test } from "@playwright/test";
import { COMMITTED_ORIGIN } from "../playwright.config";

/**
 * Regression guards for the icon + popover spacing on the two active surfaces.
 *
 * These should fail before the CSS fix (red) and pass after (green):
 *   - popover trigger hit area below 44px
 *   - icon / label spacing at 4px
 *   - canonical value rendered at 12px
 *
 * They also guard panel containment at the viewports we care about.
 */

const DESKTOP = { width: 1280, height: 800 };
const NARROW = { width: 640, height: 800 };
const MOBILE = { width: 390, height: 844 };

for (const viewport of [DESKTOP, NARROW, MOBILE]) {
  test(`hero popover is reachable and legible at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${COMMITTED_ORIGIN}/impact`);

    const trigger = page.getByRole("button", { name: /View dataset identity/ });
    await expect(trigger).toBeVisible();

    const box = await trigger.boundingBox();
    expect(box).not.toBeNull();
    expect.soft(box!.height).toBeGreaterThanOrEqual(44);

    const triggerGap = await trigger.evaluate((el) => parseFloat(window.getComputedStyle(el).gap || "0"));
    expect.soft(triggerGap).toBeGreaterThanOrEqual(8);

    const eyebrowLabel = page.locator(".hero__identity .eyebrow .semantic-icon + span");
    await expect(eyebrowLabel).toBeVisible();
    const eyebrowMargin = await eyebrowLabel.evaluate((el) => parseFloat(window.getComputedStyle(el).marginLeft));
    expect.soft(eyebrowMargin).toBeGreaterThanOrEqual(8);

    await trigger.click();
    const panel = page.locator(".proof-popover__panel").first();
    await expect(panel).toBeVisible();

    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    expect.soft(panelBox!.x).toBeGreaterThanOrEqual(0);
    expect.soft(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport.width);

    const value = panel.locator(".proof-popover__value").first();
    await expect(value).toBeVisible();
    const fontSize = await value.evaluate((el) => parseFloat(window.getComputedStyle(el).fontSize));
    expect.soft(fontSize).toBeGreaterThanOrEqual(14);
  });

  test(`parity strip popover is reachable and legible at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${COMMITTED_ORIGIN}/change-plan`);

    const trigger = page.getByRole("button", { name: /View binding proof/ });
    await expect(trigger).toBeVisible();

    const box = await trigger.boundingBox();
    expect(box).not.toBeNull();
    expect.soft(box!.height).toBeGreaterThanOrEqual(44);

    const triggerGap = await trigger.evaluate((el) => parseFloat(window.getComputedStyle(el).gap || "0"));
    expect.soft(triggerGap).toBeGreaterThanOrEqual(8);

    const parityLabel = page.locator(".parity-strip .parity-label .semantic-icon + span");
    await expect(parityLabel).toBeVisible();
    const parityMargin = await parityLabel.evaluate((el) => parseFloat(window.getComputedStyle(el).marginLeft));
    expect.soft(parityMargin).toBeGreaterThanOrEqual(8);

    await trigger.click();
    const panel = page.locator(".proof-popover__panel").first();
    await expect(panel).toBeVisible();

    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    expect.soft(panelBox!.x).toBeGreaterThanOrEqual(0);
    expect.soft(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport.width);

    const value = panel.locator(".proof-popover__value").first();
    await expect(value).toBeVisible();
    const fontSize = await value.evaluate((el) => parseFloat(window.getComputedStyle(el).fontSize));
    expect.soft(fontSize).toBeGreaterThanOrEqual(14);
  });
}
