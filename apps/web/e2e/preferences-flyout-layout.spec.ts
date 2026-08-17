import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Layout guards for the preferences flyout: it must stay fully on-screen at every window size (it
 * used to open to the right of the menu unconditionally and got cropped by a narrow window), and its
 * rows must stay one line tall (the longest label wrapped, which read as a centered row in a
 * left-aligned stack).
 */

async function openPreferencesFlyout(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-preferences").click();
  await expect(page.getByTestId("main-menu-preferences-flyout")).toBeVisible();
}

const VIEWPORTS = [
  { width: 1440, height: 900 }, // desktop: opens beside the menu
  { width: 900, height: 700 }, // pinched window: flips or clamps
  { width: 390, height: 844 }, // phone: overlaps the menu rather than hanging off-screen
];

for (const viewport of VIEWPORTS) {
  test(`preferences flyout stays inside a ${viewport.width}x${viewport.height} window`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openPreferencesFlyout(page);

    const box = (await page.getByTestId("main-menu-preferences-flyout").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

    // The longest row: one line, and not ellipsized at the flyout's width.
    const row = page.getByTestId("main-menu-toggle-properties-panel");
    expect((await row.boundingBox())!.height).toBeLessThan(40);
    const label = await row.evaluate((element) => {
      const span = element.querySelectorAll("span")[1] as HTMLElement;
      return { scrollWidth: span.scrollWidth, clientWidth: span.clientWidth };
    });
    expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
  });
}

test.describe("touch density", () => {
  test.use({ viewport: { width: 820, height: 620 }, hasTouch: true });

  test("preferences flyout fits a short coarse-pointer window", async ({ page }) => {
    await openPreferencesFlyout(page);
    // 44px rows can outgrow a short window — the panel scrolls internally instead of overflowing it.
    const box = (await page.getByTestId("main-menu-preferences-flyout").boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(620);
    expect(box.x + box.width).toBeLessThanOrEqual(820);
  });
});
