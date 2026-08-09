import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Regression coverage for the theme-consistency defect: in system/selected dark mode the chrome went
 * dark but the canvas surface stayed transparent (browser white) and newly-drawn strokes/text stayed
 * near-black, so lines and text were invisible. These tests assert the *rendered pixels*, not just the
 * CSS variable (the pre-existing theme test only checked the variable, which is what let the bug ship).
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function selectTheme(page: Page, mode: "light" | "dark"): Promise<void> {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId(`main-menu-theme-${mode}`).click();
}

async function drawLine(page: Page): Promise<void> {
  await page.getByTestId("toolbar-line-tool").click();
  await page.mouse.move(400, 450);
  await page.mouse.down();
  await page.mouse.move(500, 470);
  await page.mouse.move(600, 485);
  await page.mouse.move(700, 500);
  await page.mouse.up();
  // The static layer repaints on the next animation frame after the scene mutation — wait for a couple
  // of frames so a pixel scan reads the committed stroke, not the frame before it rendered.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
}

/** Reads the canvas-host element's *painted* background (must be an opaque themed color, never transparent). */
function readCanvasHostBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="deviva-draw-canvas-host"]')!).backgroundColor);
}

/** Scans a screen-space rectangle across every canvas layer for opaque pixels, returning the brightest one found (its RGB sum). */
function scanStroke(page: Page, box: { x: number; y: number; w: number; h: number }): Promise<{ opaque: number; brightestSum: number }> {
  return page.evaluate((b) => {
    let opaque = 0;
    let brightestSum = -1;
    for (const cv of Array.from(document.querySelectorAll("canvas"))) {
      const ctx = cv.getContext("2d");
      if (!ctx) continue;
      const rect = cv.getBoundingClientRect();
      const sx = cv.width / rect.width;
      const sy = cv.height / rect.height;
      const x = Math.max(0, Math.round((b.x - rect.left) * sx));
      const y = Math.max(0, Math.round((b.y - rect.top) * sy));
      const w = Math.min(cv.width - x, Math.round(b.w * sx));
      const h = Math.min(cv.height - y, Math.round(b.h * sy));
      if (w <= 0 || h <= 0) continue;
      const data = ctx.getImageData(x, y, w, h).data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3]! > 20) {
          opaque++;
          const sum = data[i]! + data[i + 1]! + data[i + 2]!;
          if (sum > brightestSum) brightestSum = sum;
        }
      }
    }
    return { opaque, brightestSum };
  }, box);
}

const LINE_REGION = { x: 380, y: 435, w: 340, h: 85 };

test("dark mode paints an opaque dark canvas surface (not transparent white)", async ({ page }) => {
  await selectTheme(page, "dark");
  const bg = await readCanvasHostBackground(page);
  // Must be an opaque color, and a dark one (each channel low) — never rgba(...,0) transparent.
  expect(bg).not.toMatch(/,\s*0\)$/);
  const channels = bg.match(/\d+/g)!.map(Number);
  expect(channels[0]! + channels[1]! + channels[2]!).toBeLessThan(160);
});

test("a line drawn in dark mode renders as a visible (light) stroke", async ({ page }) => {
  await selectTheme(page, "dark");
  await drawLine(page);
  const { opaque, brightestSum } = await scanStroke(page, LINE_REGION);
  expect(opaque).toBeGreaterThan(0); // the stroke actually rendered
  expect(brightestSum).toBeGreaterThan(400); // and it is light (adapts to the dark canvas), not near-black
});

test("a line drawn in light mode renders as a visible (dark) stroke", async ({ page }) => {
  await selectTheme(page, "light");
  await drawLine(page);
  const { opaque } = await scanStroke(page, LINE_REGION);
  expect(opaque).toBeGreaterThan(0);
});

test("text typed in dark mode is legible (light text on the dark editor backing) and the box grows to fit", async ({ page }) => {
  await selectTheme(page, "dark");
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(400, 350);

  const textarea = page.getByTestId("text-editor-overlay-textarea");
  await expect(textarea).toBeVisible();

  const emptyWidth = (await textarea.boundingBox())!.width;
  await textarea.fill("The quick brown fox jumps over the lazy dog");

  // Text color must contrast the editor backing (light-on-dark), not repeat the near-black default.
  const { color, background } = await textarea.evaluate((node) => {
    const cs = getComputedStyle(node);
    return { color: cs.color, background: cs.backgroundColor };
  });
  const lum = (rgb: string) => rgb.match(/\d+/g)!.slice(0, 3).map(Number).reduce((a, b) => a + b, 0);
  expect(lum(color)).toBeGreaterThan(400); // light text
  expect(lum(background)).toBeLessThan(160); // dark backing
  expect(lum(color) - lum(background)).toBeGreaterThan(300); // clearly legible contrast

  // The overlay grows to fit the long line instead of clipping it at the initial near-zero width.
  const filledWidth = (await textarea.boundingBox())!.width;
  expect(filledWidth).toBeGreaterThan(emptyWidth + 50);
});
