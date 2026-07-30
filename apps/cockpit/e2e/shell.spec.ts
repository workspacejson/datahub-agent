import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
  test(`shell is accessible at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("status")).toContainText("DESIGN PLACEHOLDER");
    await expect(page.getByRole("navigation", { name: "Review sequence" })).toBeVisible();
    // `exact` because role-name matching is substring by default, and the
    // decision rail now offers "Review receipts" alongside the "Receipts" tab.
    await page.getByRole("button", { name: "Change plan", exact: true }).click();
    await page.getByRole("button", { name: "Receipts", exact: true }).click();
    await expect(page.getByRole("heading", { name: /resolution remains bounded/i })).toBeVisible();
    await page.getByText("Raw evidence receipt", { exact: true }).click();
    await expect(page.getByRole("button", { name: /copy raw receipt/i })).toBeDisabled();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`cockpit-shell-${viewport.width}x${viewport.height}.png`), fullPage: true });
  });
}
