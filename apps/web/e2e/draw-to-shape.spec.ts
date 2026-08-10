import { test, expect } from "@playwright/test";

/**
 * "Draw to shape" (Shift+X): a rough freehand stroke is recognized and replaced by a clean shape.
 * After conversion the selection is no longer a freehand stroke, so the "Draw to shape" affordance
 * (which only shows for a single freehand selection) disappears.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

/** Draw a rough rectangular closed path with the freehand tool (auto-selected on release). */
async function drawRoughRectangle(page: import("@playwright/test").Page) {
  await page.getByTestId("toolbar-freedraw-tool").click();
  const path: [number, number][] = [
    [320, 300], [400, 300], [500, 300],
    [500, 360], [500, 420],
    [400, 420], [320, 420],
    [320, 360], [320, 300],
  ];
  await page.mouse.move(path[0]![0], path[0]![1]);
  await page.mouse.down();
  for (const [x, y] of path.slice(1)) await page.mouse.move(x, y);
  await page.mouse.up();
}

test("converting a freehand stroke via the panel button replaces it with a clean shape", async ({ page }) => {
  await drawRoughRectangle(page);

  // A single freehand stroke is selected → the "Draw to shape" button is offered.
  await expect(page.getByTestId("draw-to-shape")).toBeVisible();
  await page.getByTestId("draw-to-shape").click();

  // The selection is now a clean shape, not a freehand stroke → the button is gone, but something is
  // still selected (the new shape).
  await expect(page.getByTestId("draw-to-shape")).toHaveCount(0);
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();
});

test("Shift+X converts the selected freehand stroke", async ({ page }) => {
  await drawRoughRectangle(page);
  await expect(page.getByTestId("draw-to-shape")).toBeVisible();

  await page.keyboard.press("Shift+x");
  await expect(page.getByTestId("draw-to-shape")).toHaveCount(0);
});
