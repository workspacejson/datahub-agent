import { expect, test } from "@playwright/test";
import { BUILT_ORIGIN } from "../playwright.config";

/**
 * The subject a judge lands on, whatever the URL says.
 *
 * Jaffle Shop was removed from the dataset selector on 2026-08-02, because its
 * `code.projectPrefix` is `""`: the dbt path and the repository path are the same
 * string, so there is no prefix to normalize and the silent zero cannot occur. A
 * judge switching to it watched the headline failure disappear beneath a headline
 * still promising proof.
 *
 * Removing it from the selector removed the *chrome* and not the *route*.
 * `readLocation` read `?dataset=` raw, with no validation, while its two siblings
 * `route` and `state` were both parsed through a schema with a fallback. So
 * `/impact?dataset=root` still rendered `customers` on the deployed build, and
 * `writeLocation` rewrote the parameter on every navigation, which makes a stale
 * link sticky rather than self-correcting.
 *
 * That is the worst reachable state this product has: a first frame whose
 * headline promises proof of a silent join failure, above a dataset that cannot
 * exhibit one. It is reachable from a bookmark, a shared link, or browser history
 * predating the removal, and it needs no interaction to land on.
 *
 * These assert the subject rather than the absence of a selector, because the
 * subject is what a judge sees and the selector is an implementation of it.
 */

const GOLDEN_SUBJECT = "game_events";
/** The corpus that cannot exhibit the failure. Named so a regression says why. */
const CONTRAST_SUBJECT = "customers";

for (const search of ["", "?dataset=root", "?dataset=nested", "?dataset=", "?dataset=not-a-key"]) {
  test(`lands on the golden subject at /impact${search || " (no query)"}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BUILT_ORIGIN}/impact${search}`);

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText(GOLDEN_SUBJECT);
    await expect(heading).not.toHaveText(CONTRAST_SUBJECT);
  });
}

test("the coordinate seam is present on the subject a judge lands on", async ({ page }) => {
  /*
    The claim under the headline, not just the headline.

    "joining them silently returns nothing. Here is the proof." is followed by the
    two coordinate rows: the catalog row with an empty prefix slot, the repository
    row with the prefix that fills it. On a zero-prefix corpus `CoordinateSeam`
    returns null and the sentence is left promising a proof that is not there.

    Asserting the seam rather than the sentence is deliberate: the sentence can be
    rendered by any build, and the seam can only be rendered by a subject that
    actually has a gap to show.
  */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BUILT_ORIGIN}/impact?dataset=root`);

  const seam = page.getByLabel("The same file in two coordinate systems");
  await expect(seam).toBeVisible();
  await expect(seam).toContainText("dbt/");
});

test("a rejected dataset key does not persist into the URL on navigation", async ({ page }) => {
  // `writeLocation` rewrites the parameter on every route change, so an
  // unvalidated key survives navigation and outlives the tab it arrived in. The
  // key that actually rendered is the one that belongs in the address bar.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BUILT_ORIGIN}/impact?dataset=root`);
  await page.getByRole("button", { name: "Continue to change plan" }).click();

  await expect(page).not.toHaveURL(/dataset=root/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(GOLDEN_SUBJECT);
});
