import { test, expect } from "@playwright/test";

/** Drawing area kept well clear of the top chrome (toolbar/top-bar) and the right-docked properties panel. */
const DRAW_START = { x: 300, y: 300 };
const DRAW_END = { x: 480, y: 420 };
const DRAW_CENTER = { x: 390, y: 360 };

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("draws a rectangle via the toolbar, selects it, and changes its style", async ({ page }) => {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await expect(page.getByTestId("toolbar-rectangle-tool")).toHaveAttribute("aria-pressed", "true");

  await page.mouse.move(DRAW_START.x, DRAW_START.y);
  await page.mouse.down();
  await page.mouse.move(DRAW_END.x, DRAW_END.y);
  await page.mouse.up();

  // Selecting requires the select tool (drawing a shape leaves the shape tool itself active).
  await page.getByTestId("toolbar-select-tool").click();
  await page.mouse.click(DRAW_CENTER.x, DRAW_CENTER.y);

  // Layer actions only render once something is selected — confirms the click actually hit the shape.
  await expect(page.getByTestId("layer-action-bring-to-front")).toBeVisible();

  // Style change: stroke width thin -> bold.
  await page.getByTestId("stroke-width-bold").click();
  await expect(page.getByTestId("stroke-width-bold")).toHaveAttribute("aria-pressed", "true");
});

test("undo reverts the most recent change (drawing a rectangle)", async ({ page }) => {
  await expect(page.getByTestId("top-bar-undo")).toBeDisabled();

  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(DRAW_START.x, DRAW_START.y);
  await page.mouse.down();
  await page.mouse.move(DRAW_END.x, DRAW_END.y);
  await page.mouse.up();

  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
  await page.getByTestId("top-bar-undo").click();
  await expect(page.getByTestId("top-bar-undo")).toBeDisabled();
});
