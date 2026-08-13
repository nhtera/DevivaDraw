import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The suggested-binding halo — the "you can connect here" affordance. Detected by sampling the
 * interactive (overlay) canvas for the highlight's own light-blue, which nothing else on that layer
 * paints: the selection frame and marquee use `#1971c2`, snap guides `#e64980`, the laser red.
 */

const SHAPE = { left: 500, top: 300, right: 700, bottom: 450 } as const;
const EDGE_PROBE = { x: SHAPE.left, y: (SHAPE.top + SHAPE.bottom) / 2 } as const;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

/**
 * Whether the overlay canvas paints the halo's own colour near `point`.
 *
 * Matched tightly against `rgba(106,189,252,1)` rather than "anything blue": the selection frame's
 * `#1971c2` antialiases toward the white canvas, and partway along that blend it passes through
 * colours a loose "high blue" test cannot tell from the halo. At the blend where its red matches the
 * halo's, its green and blue are still ~26 and ~37 away — hence the ±20 window.
 */
async function hasHaloNear(page: Page, point: { x: number; y: number }): Promise<boolean> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
  return page.evaluate(({ x, y }) => {
    const canvases = [...document.querySelectorAll('[data-testid="deviva-draw-canvas-host"] canvas')] as HTMLCanvasElement[];
    const overlay = canvases[canvases.length - 1]!; // the interactive layer is stacked last
    const ratio = overlay.width / overlay.clientWidth;
    const ctx = overlay.getContext("2d")!;
    const RADIUS = 14;
    const data = ctx.getImageData((x - RADIUS) * ratio, (y - RADIUS) * ratio, RADIUS * 2 * ratio, RADIUS * 2 * ratio).data;
    const [tr, tg, tb] = [106, 189, 252];
    const TOLERANCE = 20;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 200) continue; // ignore antialiased fringes; the halo core is opaque
      if (Math.abs(data[i]! - tr) <= TOLERANCE && Math.abs(data[i + 1]! - tg) <= TOLERANCE && Math.abs(data[i + 2]! - tb) <= TOLERANCE) return true;
    }
    return false;
  }, point);
}

/** Draws the target shape and deselects it, so the selection frame is never in the sampled region. */
async function drawShape(page: Page): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(SHAPE.left, SHAPE.top);
  await page.mouse.down();
  await page.mouse.move(SHAPE.right, SHAPE.bottom);
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.mouse.click(200, 600); // click empty canvas to clear the selection
}

test("hovering a shape with the arrow tool haloes it, and moving away clears it", async ({ page }) => {
  await drawShape(page);
  await page.getByTestId("toolbar-arrow-tool").click();

  expect(await hasHaloNear(page, EDGE_PROBE)).toBe(false); // nothing before the pointer arrives

  await page.mouse.move(EDGE_PROBE.x, EDGE_PROBE.y);
  expect(await hasHaloNear(page, EDGE_PROBE)).toBe(true);

  await page.mouse.move(300, 600); // off every shape
  expect(await hasHaloNear(page, EDGE_PROBE)).toBe(false);
});

test("the halo does not appear for the select tool — it is the arrow tool's affordance", async ({ page }) => {
  await drawShape(page);
  await page.getByTestId("toolbar-select-tool").click();

  await page.mouse.move(EDGE_PROBE.x, EDGE_PROBE.y);
  expect(await hasHaloNear(page, EDGE_PROBE)).toBe(false);
});

test("switching away from the arrow tool clears a halo left showing", async ({ page }) => {
  await drawShape(page);
  await page.getByTestId("toolbar-arrow-tool").click();
  await page.mouse.move(EDGE_PROBE.x, EDGE_PROBE.y);
  expect(await hasHaloNear(page, EDGE_PROBE)).toBe(true);

  await page.getByTestId("toolbar-select-tool").click();
  expect(await hasHaloNear(page, EDGE_PROBE)).toBe(false);
});

test("the halo tracks the moving endpoint during an arrow drag, then clears on commit", async ({ page }) => {
  await drawShape(page);
  await page.getByTestId("toolbar-arrow-tool").click();

  await page.mouse.move(300, 375);
  await page.mouse.down();
  await page.mouse.move(400, 375);
  await page.mouse.move(EDGE_PROBE.x - 6, EDGE_PROBE.y); // endpoint now within bind range of the shape
  expect(await hasHaloNear(page, EDGE_PROBE)).toBe(true);

  await page.mouse.up();
  expect(await hasHaloNear(page, EDGE_PROBE)).toBe(false); // committed: the affordance is done
});
