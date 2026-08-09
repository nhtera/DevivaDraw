import { test, expect } from "@playwright/test";

/**
 * Parity with Excalidraw/tldraw for the non-text tools: a clean idle canvas (no panel until a tool is
 * active or something is selected), click-to-place a default shape, and the eraser tool.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("the properties panel is hidden on the idle canvas and appears once a creation tool is active", async ({ page }) => {
  // Idle: select tool active, nothing selected → clean canvas, no panel (matching competitors).
  await expect(page.getByTestId("properties-panel")).toHaveCount(0);

  // A creation tool shows the panel (its "next shape" defaults).
  await page.getByTestId("toolbar-rectangle-tool").click();
  await expect(page.getByTestId("properties-panel")).toBeVisible();

  // Back to the select tool with nothing selected → hidden again.
  await page.getByTestId("toolbar-select-tool").click();
  await expect(page.getByTestId("properties-panel")).toHaveCount(0);
});

test("clicking (no drag) with a shape tool drops a default-sized shape and selects it", async ({ page }) => {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.click(500, 380); // a plain click, not a drag

  // A real element was created (undoable) and auto-selected — control handed back to select.
  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
  await expect(page.getByTestId("toolbar-select-tool")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();
});

test("the eraser tool removes an element dragged over, and has a toolbar button + shortcut", async ({ page }) => {
  // Counts "ink" pixels (dark stroke on the default light canvas) in the shape's region.
  const inkInRegion = async (): Promise<number> =>
    page.evaluate(() => {
      const canvases = [...document.querySelectorAll("canvas")];
      const cv = canvases[canvases.length - 2]!; // static layer holds committed elements
      const ctx = cv.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;
      const d = ctx.getImageData(Math.round(280 * dpr), Math.round(280 * dpr), Math.round(240 * dpr), Math.round(180 * dpr)).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4) {
        const lum = d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114;
        if (d[i + 3]! > 120 && lum < 120) ink++;
      }
      return ink;
    });

  // Draw a rectangle by dragging.
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(500, 440);
  await page.mouse.up();
  expect(await inkInRegion()).toBeGreaterThan(20); // ink is present

  // The eraser has its own toolbar button, and its shortcut selects it.
  await expect(page.getByTestId("toolbar-eraser-tool")).toBeVisible();
  await page.keyboard.press("e");
  await expect(page.getByTestId("toolbar-eraser-tool")).toHaveAttribute("aria-pressed", "true");

  // Swipe across the rectangle's edges — its ink is gone afterward.
  await page.mouse.move(290, 370);
  await page.mouse.down();
  for (let x = 290; x <= 510; x += 15) await page.mouse.move(x, 370);
  await page.mouse.up();

  await expect.poll(inkInRegion).toBeLessThan(5);
});
