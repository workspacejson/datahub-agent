import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import { COMMITTED_ORIGIN } from "../playwright.config";

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

/** Clearance the decision must keep below itself, in CSS pixels. */
const FOLD_HEADROOM = 48;

for (const viewport of VIEWPORTS) {
  test(`first frame contains its own content at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${COMMITTED_ORIGIN}/impact`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const overflowing = await page.evaluate(() => {
      const offenders: string[] = [];
      for (const element of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
        // An element that declares itself scrollable on x is allowed to be
        // wider than its box. Everything else overflowing is content a reader
        // silently loses: `visible` spills outside the panel, `hidden` clips.
        const overflowX = getComputedStyle(element).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") continue;
        // `clientWidth` is 0 for anything without a layout box of its own:
        // inline elements, and content inside a collapsed `<details>`. Firefox
        // reports a non-zero `scrollWidth` for those where Chromium reports 0,
        // so the raw comparison fired on every `<code>` in a closed disclosure.
        // Zero is "not a box that can overflow", not "a box overflowing by all
        // of its content". The defect this guards had a 754px client width, so
        // skipping unlaid-out elements does not weaken it.
        if (element.clientWidth === 0) continue;
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
    await page.goto(`${COMMITTED_ORIGIN}/impact`);

    const cta = page.getByRole("button", { name: "Continue to change plan" });
    await expect(cta).toBeVisible();

    const box = await cta.boundingBox();
    expect(box).not.toBeNull();
    // Fully inside the first frame, not merely intersecting it. A button whose
    // label is half cut off is not an answer to "what is the next action".
    expect(box!.y).toBeGreaterThanOrEqual(0);

    // With headroom, not merely inside. `<= viewport.height` passes at one pixel
    // of clearance, and a guard that clears by a pixel is a guard the next copy
    // edit silently breaks: a longer stated-gap reason or a wider field name
    // pushes the rail down and nothing fails until a reader is already scrolling.
    // FOLD_HEADROOM is roughly two lines of body copy at this size.
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - FOLD_HEADROOM);

    // The frame must not buy the CTA's place by dropping what the reader needs
    // to judge it. All four have to be in the same unscrolled frame.
    // The coverage panel now carries the epistemic state and the thesis together,
    // which is the point of collapsing three registers into one. It is still
    // asserted, so dropping either would fail here.
    for (const locator of [
      page.getByRole("heading", { level: 1 }),                       // dataset identity
      page.getByLabel("Coverage of this review"),                    // epistemic state + how much is known
      page.getByLabel("Stated gaps and next action"),                // material gaps
    ]) {
      const region = await locator.first().boundingBox();
      expect(region).not.toBeNull();
      expect(region!.y).toBeLessThan(viewport.height);
    }

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test(`the next action survives the copy that can actually grow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${COMMITTED_ORIGIN}/impact`);

    // Headroom is a number; this is what the number is for. Only the strings
    // that can really vary are grown, because a test of impossible growth
    // reports a failure nobody can cause and hides the one they can:
    //
    //   stated gaps   contract-supplied, unbounded in count and length. This is
    //                 the real vector, and the rail caps the list and scrolls it
    //                 rather than growing. Twenty is well past any observed event.
    //   caveat        composed from a count, so it can gain a line, not a page.
    //
    // The completeness headline and the count subjects are fixed strings from a
    // closed enum and from this file's own markup; they cannot grow at runtime,
    // and doubling them was testing the frame against an edit no event can make.
    await page.evaluate(() => {
      const list = document.querySelector(".rail-group ul");
      const template = list?.querySelector("li");
      if (list && template) {
        for (let i = 0; i < 20; i += 1) {
          const clone = template.cloneNode(true) as HTMLElement;
          const name = clone.querySelector("strong");
          if (name) name.textContent = `provenance.datahub.someLongerFieldName${i}`;
          list.append(clone);
        }
      }
      const caveat = document.querySelector(".rail-caveat");
      if (caveat) caveat.textContent = `${caveat.textContent} Each is named in the receipt with the system that could not supply it.`;
    });

    const cta = page.getByRole("button", { name: "Continue to change plan" });
    const box = await cta.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

    // The cap is what made that true, so it is asserted rather than assumed.
    const capped = await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>(".rail-group ul");
      return list ? list.scrollHeight > list.clientHeight : false;
    });
    expect(capped, "the stated-gap list must scroll rather than grow the rail").toBe(true);
  });
}

test("the changed-plan destination shows the real evidence-backed delta", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto(`${COMMITTED_ORIGIN}/impact`);
  await page.getByRole("button", { name: "Continue to change plan" }).click();

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

test("every receipt section is reachable, distinct, and highlights itself", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto(`${COMMITTED_ORIGIN}/receipts`);

  // Receipts is far taller than the other two routes and holds six distinct
  // arguments; none of them appeared in any navigation, and the rail sat empty
  // here, so the widest column was unused where wayfinding was needed most.
  const index = page.getByRole("navigation", { name: "Receipt sections" });
  await expect(index).toBeVisible();
  const links = index.getByRole("link");
  const labels = await links.allTextContents();
  expect(labels.length).toBeGreaterThan(4);

  // The invariant the first version of this test missed: an index entry has to be
  // able to go where it says. The document used to end 521px too early, so the
  // final two headings could never reach the reading line: clicking either landed
  // at the same maximum offset and neither could ever become active. Asserting
  // only that the highlight moved somewhere passed straight through that.
  const offsets: number[] = [];
  for (const label of labels) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await index.getByRole("link", { name: label, exact: true }).click();

    const target = await index.getByRole("link", { name: label, exact: true })
      .evaluate((node) => (node as HTMLAnchorElement).getAttribute("href")!);
    // The heading actually arrives at the top of the viewport, rather than merely
    // being somewhere on screen because the page could not scroll any further.
    await expect
      .poll(async () => Math.round((await page.locator(target).boundingBox())!.y), { timeout: 4000 })
      .toBeLessThan(72);

    await expect(index.locator("[aria-current='location']")).toHaveText(label);
    offsets.push(await page.evaluate(() => Math.round(window.scrollY)));
  }

  // Distinct destinations. Equal offsets would mean the index is offering choices
  // that resolve to one place, which is what a reader reported as "they all go to
  // the same breakpoint".
  expect(new Set(offsets).size).toBe(offsets.length);
  expect([...offsets]).toEqual([...offsets].sort((a, b) => a - b));
});

/**
 * The committed build renders the golden evidence, and asks nothing outside its
 * own origin for it.
 *
 * This is the pair of claims the old `live` source mode implied and never
 * established. `fixture` and `live` read the same committed bytes at build time,
 * so a build labelled `live` had contacted nothing, and no test compared the
 * label against behaviour. Asserting the behaviour directly means the guarantee
 * survives whatever the modes are called: the page shows the golden subject, and
 * every request it makes is same-origin.
 *
 * The static half lives in `architecture-invariants.test.ts`, which refuses a
 * network call anywhere in the browser's import graph. This is the runtime
 * confirmation that nothing slipped past it, including through a stylesheet or a
 * transitive dependency the walk could not follow.
 */
test("the committed build renders the golden subject and never leaves its origin", async ({ page }) => {
  const golden = JSON.parse(
    readFileSync(new URL("../../../test/fixtures/golden/change-impact-event.nested.json", import.meta.url), "utf8"),
  ) as { subject: { urn: string } };

  const offOrigin: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    // `data:` and `blob:` carry no network hop: a blob URL is how the receipt
    // download hands bytes to the browser, and failing on it would make the fix
    // for HAC-287 look like a network dependency.
    if (url.startsWith(COMMITTED_ORIGIN) || url.startsWith("data:") || url.startsWith("blob:")) return;
    offOrigin.push(url);
  });

  await page.goto(`${COMMITTED_ORIGIN}/impact`);

  // The evidence is really the committed golden package, not an empty shell that
  // happens to render without erroring.
  await expect(page.getByText(golden.subject.urn, { exact: false }).first()).toBeVisible();
  // And no placeholder build slipped onto this origin.
  await expect(page.getByText("DESIGN PLACEHOLDER")).toHaveCount(0);

  expect(offOrigin, `the cockpit requested ${offOrigin.length} off-origin URL(s)`).toEqual([]);
});
