import { test, expect } from "@playwright/test";

/**
 * Tablet tier: a desktop-sized viewport whose primary pointer is coarse (an iPad in landscape) gets
 * the DESKTOP chrome — top toolbar + side panel, not the phone bottom-toolbar — with touch-sized
 * (>=44px effective) targets, keyed off the shell root's `data-dd-density="touch"` attribute.
 * `isMobile` + `hasTouch` is what makes Chromium report `(pointer: coarse)`.
 */

test.use({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("desktop layout with touch density on a wide coarse-pointer viewport", async ({ page }) => {
  await expect(page.getByTestId("deviva-draw-root")).toHaveAttribute("data-dd-density", "touch");

  // Desktop chrome, not the phone tier.
  await expect(page.getByTestId("toolbar-select-tool")).toBeVisible();
  await expect(page.getByTestId("bottom-toolbar-rectangle-tool")).toHaveCount(0);

  // Toolbar buttons meet the 44px touch-target floor.
  const box = (await page.getByTestId("toolbar-select-tool").boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});

test("compact chrome: hamburger-only top bar, centered toolbar, history/zoom bottom-left", async ({ page }) => {
  // The tablet arrangement mirrors the genre convention: the top bar shrinks to just the menu
  // trigger so the centered toolbar owns the whole top row, and undo/redo + zoom move to a
  // bottom-left island (whose zoom popover opens upward).
  const topBarButtons = page.locator('[data-testid="top-bar"] button');
  await expect(topBarButtons).toHaveCount(1);
  await expect(page.getByTestId("top-bar-menu")).toBeVisible();

  const topBar = (await page.getByTestId("top-bar").boundingBox())!;
  const toolbar = (await page.getByTestId("toolbar").boundingBox())!;
  expect(toolbar.x).toBeGreaterThanOrEqual(topBar.x + topBar.width); // same row, no overlap

  const bottomControls = page.getByTestId("tablet-bottom-controls");
  await expect(bottomControls).toBeVisible();
  await expect(bottomControls.getByTestId("top-bar-undo")).toBeVisible();
  const zoomMinHeight = await bottomControls.getByTestId("top-bar-zoom-in").evaluate((element) => getComputedStyle(element).minHeight);
  expect(zoomMinHeight).toBe("44px");

  await bottomControls.getByTestId("top-bar-zoom-percentage").click();
  const popover = (await page.getByTestId("zoom-menu-popover").boundingBox())!;
  const trigger = (await bottomControls.getByTestId("top-bar-zoom-percentage").boundingBox())!;
  expect(popover.y + popover.height).toBeLessThanOrEqual(trigger.y + 1); // opens upward
});

test("menu rows grow to touch height", async ({ page }) => {
  await page.getByTestId("top-bar-menu").click();
  // Computed style, not boundingBox: isMobile's visual-viewport scaling shrinks measured boxes by a
  // few hundredths, while the applied CSS floor is what this asserts.
  const minHeight = await page.getByTestId("main-menu-open").evaluate((element) => getComputedStyle(element).minHeight);
  expect(minHeight).toBe("44px");
});
