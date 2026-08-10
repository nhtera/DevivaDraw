import { test, expect } from "@playwright/test";

/**
 * Personal element library (Excalidraw parity): save a selection, re-insert it, remove it, and
 * persist across reload.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function openLibrary(page: import("@playwright/test").Page) {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-library").click();
  await expect(page.getByTestId("library-panel")).toBeVisible();
}

async function drawRect(page: import("@playwright/test").Page) {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(360, 300);
  await page.mouse.down();
  await page.mouse.move(480, 400);
  await page.mouse.up();
}

test("saving a selection adds a library item, and it persists across reload", async ({ page }) => {
  await drawRect(page); // auto-selected
  await openLibrary(page);

  await page.getByTestId("library-add").click();
  await expect(page.getByTestId("library-item")).toHaveCount(1);

  // Reload → the item is restored from localStorage.
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await openLibrary(page);
  await expect(page.getByTestId("library-item")).toHaveCount(1);
});

test("clicking a library item inserts a fresh copy onto the canvas", async ({ page }) => {
  await drawRect(page);
  await openLibrary(page);
  await page.getByTestId("library-add").click();
  await expect(page.getByTestId("library-item")).toHaveCount(1);

  // Deselect by clicking empty canvas (away from the left-side library panel) so the layer actions
  // disappear; inserting from the library must bring them back with the freshly-inserted copy.
  await page.mouse.click(760, 200);
  await expect(page.locator('[data-testid^="layer-action-"]')).toHaveCount(0);

  await page.getByTestId("library-item").click();
  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();
});

test("removing a library item empties the library", async ({ page }) => {
  await drawRect(page);
  await openLibrary(page);
  await page.getByTestId("library-add").click();
  await expect(page.getByTestId("library-item")).toHaveCount(1);

  await page.getByTestId("library-item-remove").click();
  await expect(page.getByTestId("library-item")).toHaveCount(0);
});
