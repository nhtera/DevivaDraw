import { test, expect } from "@playwright/test";

/**
 * Mobile chrome: the properties controls must NOT be the desktop top-right panel (which covers most of a
 * phone screen). Below the 768px breakpoint the style controls collapse to a compact bar (stroke + bg
 * swatches + a "Style" toggle) docked above the tool row, and the full controls open in a bottom sheet
 * only on demand — so the canvas stays visible (Excalidraw-style).
 */

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("idle canvas shows no properties chrome on mobile", async ({ page }) => {
  // Select tool active, nothing selected → nothing to style, so neither the desktop panel nor the mobile bar shows.
  await expect(page.getByTestId("properties-panel")).toHaveCount(0);
  await expect(page.getByTestId("mobile-properties-bar")).toHaveCount(0);
});

test("a creation tool shows the compact bar, not the full desktop panel", async ({ page }) => {
  await page.getByTestId("bottom-toolbar-rectangle-tool").click();

  // The desktop top-right panel never renders on mobile; the compact bar does.
  await expect(page.getByTestId("properties-panel")).toHaveCount(0);
  await expect(page.getByTestId("mobile-properties-bar")).toBeVisible();
  await expect(page.getByTestId("mobile-stroke-swatch")).toBeVisible();
  await expect(page.getByTestId("mobile-background-swatch")).toBeVisible();

  // The full controls stay hidden until the user asks for them.
  await expect(page.getByTestId("mobile-properties-sheet")).toHaveCount(0);
});

test("the Style toggle opens and closes the full controls sheet", async ({ page }) => {
  await page.getByTestId("bottom-toolbar-rectangle-tool").click();
  await page.getByTestId("mobile-properties-toggle").click();

  // The sheet carries the full style controls (same body as desktop): stroke + background pickers.
  const sheet = page.getByTestId("mobile-properties-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("stroke-color-more")).toBeVisible();
  await expect(sheet.getByTestId("background-color-more")).toBeVisible();

  // Toggling again closes it — the canvas is reclaimed.
  await page.getByTestId("mobile-properties-toggle").click();
  await expect(page.getByTestId("mobile-properties-sheet")).toHaveCount(0);
});

test("tapping a swatch opens the sheet", async ({ page }) => {
  await page.getByTestId("bottom-toolbar-rectangle-tool").click();
  await page.getByTestId("mobile-stroke-swatch").click();
  await expect(page.getByTestId("mobile-properties-sheet")).toBeVisible();
});

test("a color popover inside the sheet renders fully (portaled, not clipped by the scroll container)", async ({ page }) => {
  await page.getByTestId("bottom-toolbar-rectangle-tool").click();
  await page.getByTestId("mobile-properties-toggle").click();
  await page.getByTestId("stroke-color-more").click();

  // The popover is portaled to <body>, so its full contents — including the hex input at the bottom —
  // stay visible instead of being cut off by the sheet's `overflow: auto`.
  await expect(page.getByTestId("stroke-color-popover")).toBeVisible();
  await expect(page.getByTestId("stroke-color-hex")).toBeVisible();
});

test("Escape closes an open color popover without also collapsing the whole sheet", async ({ page }) => {
  await page.getByTestId("bottom-toolbar-rectangle-tool").click();
  await page.getByTestId("mobile-properties-toggle").click();
  await page.getByTestId("stroke-color-more").click();
  await expect(page.getByTestId("stroke-color-popover")).toBeVisible();

  await page.keyboard.press("Escape");

  // One Escape backs out of the popover only — the sheet stays open.
  await expect(page.getByTestId("stroke-color-popover")).toHaveCount(0);
  await expect(page.getByTestId("mobile-properties-sheet")).toBeVisible();
});
