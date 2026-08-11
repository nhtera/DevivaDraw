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
    for (const cv of Array.from(document.querySelector('[data-testid="deviva-draw-canvas-host"]')!.querySelectorAll("canvas"))) {
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

test("a scene authored in light and reloaded in dark renders legibly (render-time adaptation)", async ({ page }) => {
  // Draw in light — the stroke is stored near-black.
  await selectTheme(page, "light");
  await drawLine(page);
  // Switch to dark and let autosave persist. Crucially, the *stored* color stays near-black (the swap
  // is no longer destructive), so this reproduces "a light-authored scene opened in dark mode".
  await selectTheme(page, "dark");
  await page.waitForTimeout(1300);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));

  // On load in dark mode there was no theme *toggle* to trigger the old swap — yet the near-black
  // stroke must still render LIGHT (adapted at render time), i.e. visible. This is the bug fix.
  const { opaque, brightestSum } = await scanStroke(page, LINE_REGION);
  expect(opaque).toBeGreaterThan(0);
  expect(brightestSum).toBeGreaterThan(400);
});

test("text typed in dark mode is legible (light text drawn on the dark canvas) and the box grows to fit", async ({ page }) => {
  await selectTheme(page, "dark");
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(400, 350);

  const textarea = page.getByTestId("text-editor-overlay-textarea");
  await expect(textarea).toBeVisible();

  const emptyWidth = (await textarea.boundingBox())!.width;
  await textarea.fill("The quick brown fox jumps over the lazy dog");
  // The canvas static layer paints the live draft on the next frame(s) — wait for it before scanning.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));

  // The editing textarea is a transparent input/caret layer — it must NOT paint its own glyphs (that
  // second, differently-rasterized copy is exactly what used to make text shift on commit). Only the
  // caret is tinted, to the theme-adapted (light, in dark mode) stroke color.
  const lum = (rgb: string) => rgb.match(/\d+/g)!.slice(0, 3).map(Number).reduce((a, b) => a + b, 0);
  const { color, background, caret } = await textarea.evaluate((node) => {
    const cs = getComputedStyle(node);
    return { color: cs.color, background: cs.backgroundColor, caret: cs.caretColor };
  });
  expect(color).toMatch(/rgba?\(0,\s*0,\s*0,\s*0\)/); // fully transparent text
  expect(background).toMatch(/rgba?\(0,\s*0,\s*0,\s*0\)/); // no opaque/selection box
  expect(lum(caret)).toBeGreaterThan(400); // light caret in dark mode

  // The legible glyphs live on the CANVAS now: the text region must contain light pixels on the dark surface.
  const { brightestSum } = await scanStroke(page, { x: 400, y: 350, w: 320, h: 40 });
  expect(brightestSum).toBeGreaterThan(400); // light text painted on the dark canvas

  // The overlay still grows to fit the long line (its layout drives caret placement) instead of clipping.
  const filledWidth = (await textarea.boundingBox())!.width;
  expect(filledWidth).toBeGreaterThan(emptyWidth + 50);
});
