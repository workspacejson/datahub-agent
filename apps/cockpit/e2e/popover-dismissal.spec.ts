import { expect, test } from "@playwright/test";
import { COMMITTED_ORIGIN } from "../playwright.config";

/**
 * An anchored overlay must not outlive the thing it points at.
 *
 * The unit tests drive a fake `IntersectionObserver` and assert the hook's
 * contract. They cannot tell you whether real scrolling in a real engine
 * produces the report that contract keys on, which is the part that was broken:
 * before this, scrolling past the header left an open, focused panel anchored to
 * an element no longer on screen, still in the accessibility tree, and still
 * open when the reader scrolled back up.
 *
 * So this asserts the behaviour end to end, on all three engines, and asserts
 * the *negative* case first. A rule that closes too eagerly is a worse bug than
 * the orphan: a reader who scrolls a little to see the term in the sentence it
 * came from would lose the definition mid-read, and that failure looks like a
 * flaky UI rather than a deliberate rule.
 *
 * Removal is asserted rather than invisibility. `hideWhenDetached` would satisfy
 * a screenshot and leave the overlay open to a screen reader; the DOM check is
 * what distinguishes the fix from that near-miss.
 */

const trigger = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /repo-evidence artifact/ });
const panel = (page: import("@playwright/test").Page) => page.locator(".term-def__panel");

test("a small scroll keeps the definition open", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${COMMITTED_ORIGIN}/impact`);

  await trigger(page).click();
  await expect(panel(page)).toBeVisible();

  // Small enough that the trigger stays partly on screen. This is the case the
  // "close on any scroll" alternative would have broken, so it is asserted
  // before the close, not after.
  await page.mouse.wheel(0, 40);
  await page.waitForTimeout(300);

  const box = await trigger(page).boundingBox();
  expect(box, "the trigger must still be in view for this case to be the one it claims").not.toBeNull();
  expect(box!.y + box!.height).toBeGreaterThan(0);

  await expect(panel(page)).toBeVisible();
});

test("the definition closes once its trigger has fully left the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${COMMITTED_ORIGIN}/impact`);

  await trigger(page).click();
  await expect(panel(page)).toBeVisible();

  await page.mouse.wheel(0, 1200);

  // Removed from the DOM, not merely scrolled out of sight or visually hidden.
  // `toHaveCount(0)` is the assertion that separates this fix from
  // `hideWhenDetached`, which would leave it mounted and open.
  await expect(panel(page)).toHaveCount(0);
});

test("scrolling back does not reopen it", async ({ page }) => {
  // Re-entry is the reader's decision. An overlay that reappears on scroll would
  // be a second orphan: on screen without anyone having asked for it.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${COMMITTED_ORIGIN}/impact`);

  await trigger(page).click();
  await expect(panel(page)).toBeVisible();

  await page.mouse.wheel(0, 1200);
  await expect(panel(page)).toHaveCount(0);

  await page.mouse.wheel(0, -1200);
  await expect(trigger(page)).toBeInViewport();
  await page.waitForTimeout(300);
  await expect(panel(page)).toHaveCount(0);
});

test("Escape and outside click still close it", async ({ page }) => {
  // The two exits that already worked. They are re-asserted here because this
  // change moved both components onto controlled `open` state, which is exactly
  // the kind of rewiring that silently drops a dismissal path.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${COMMITTED_ORIGIN}/impact`);

  await trigger(page).click();
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);

  await trigger(page).click();
  await expect(panel(page)).toBeVisible();
  await page.mouse.click(700, 700);
  await expect(panel(page)).toHaveCount(0);
});
