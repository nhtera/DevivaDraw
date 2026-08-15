import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Layers panel: organize / hide / lock / reveal — the four demand clusters. This file starts with
 * the Phase-3 smoke coverage; Phase 5 extends it with the full gating-attack battery.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function openLayersPanel(page: Page): Promise<void> {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-toggle-layers").click();
  await page.keyboard.press("Escape"); // close the menu; the panel stays
  await expect(page.getByTestId("layers-panel")).toBeVisible();
}

async function drawRect(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2);
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

async function cursorAt(page: Page, x: number, y: number): Promise<string> {
  await page.mouse.move(x, y);
  await page.waitForTimeout(200);
  return page.getByTestId("deviva-draw-canvas-host").evaluate((host) => (host as HTMLElement).style.cursor);
}

test("add a layer, draw onto it, hide it — the drawing vanishes and stops being clickable; show restores", async ({ page }) => {
  await drawRect(page, 400, 200, 500, 280); // default layer
  await openLayersPanel(page);

  await page.getByTestId("layers-add").click();
  await expect(page.locator('[data-testid^="layer-item-"]')).toHaveCount(2);
  await drawRect(page, 620, 200, 720, 280); // lands on the new active layer

  // Hide the new (topmost) layer: its rect stops hitting; the default layer's still does.
  await page.locator('[data-testid^="layer-visible-"]').first().click();
  expect(await cursorAt(page, 620, 240)).toBe("default");
  expect(await cursorAt(page, 400, 240)).toBe("move");

  // Show again — progressive reveal, and the content is hittable once more.
  await page.locator('[data-testid^="layer-visible-"]').first().click();
  expect(await cursorAt(page, 620, 240)).toBe("move");
});

test("locking a layer makes its content unclickable and un-marquee-able; unlock restores", async ({ page }) => {
  await openLayersPanel(page);
  await page.getByTestId("layers-add").click();
  await drawRect(page, 620, 200, 720, 280);

  await page.locator('[data-testid^="layer-locked-"]').first().click();
  expect(await cursorAt(page, 620, 240)).toBe("default"); // no move affordance — not hittable

  // Marquee across it selects nothing, so a follow-up Delete keypress has nothing to kill: after
  // unlocking, the rect must still be there.
  await page.mouse.move(570, 150);
  await page.mouse.down();
  await page.mouse.move(770, 350);
  await page.mouse.up();
  await page.keyboard.press("Delete");

  await page.locator('[data-testid^="layer-locked-"]').first().click();
  expect(await cursorAt(page, 620, 240)).toBe("move"); // survived — it was never selected
});

test("rename, reorder, move-selection-here, and guarded delete all work from the panel", async ({ page }) => {
  await openLayersPanel(page);
  await page.getByTestId("layers-add").click();

  // Rename via double-click.
  await page.locator('[data-testid^="layer-item-"]').first().dblclick();
  await page.locator('[data-testid^="layer-rename-"]').fill("Annotations");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid^="layer-item-"]').first()).toHaveText("Annotations");

  // Draw on the default layer, then move the selection onto Annotations via the per-row button.
  await page.locator('[data-testid^="layer-item-"]').last().click(); // activate default
  await drawRect(page, 400, 200, 500, 280);
  await page.mouse.click(400, 240); // select it (stroke — unfilled interiors only hit when selected)
  await expect(page.locator('[data-testid^="layer-move-here-"]')).toHaveCount(2);
  await page.locator('[data-testid^="layer-move-here-"]').first().click(); // onto Annotations
  // Hiding Annotations now hides the moved rect — proof the membership moved.
  await page.locator('[data-testid^="layer-visible-"]').first().click();
  expect(await cursorAt(page, 400, 240)).toBe("default");
  await page.locator('[data-testid^="layer-visible-"]').first().click();

  // Delete the Annotations layer: its content re-homes to the neighbor (still visible, still hittable).
  await page.locator('[data-testid^="layer-delete-"]').first().click();
  await expect(page.locator('[data-testid^="layer-item-"]')).toHaveCount(1);
  expect(await cursorAt(page, 400, 240)).toBe("move");
  // The last layer offers no delete button at all.
  await expect(page.locator('[data-testid^="layer-delete-"]')).toHaveCount(0);
});

test("layers ride reload, and the panel is absent in the share viewer", async ({ page }) => {
  let storedBlob: Buffer | null = null;
  await page.route("**/blobs/**", async (route) => {
    if (route.request().method() === "PUT") {
      storedBlob = route.request().postDataBuffer();
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/octet-stream", body: storedBlob! });
  });

  await openLayersPanel(page);
  await page.getByTestId("layers-add").click();
  await page.locator('[data-testid^="layer-item-"]').first().dblclick();
  await page.locator('[data-testid^="layer-rename-"]').fill("Notes");
  await page.keyboard.press("Enter");
  await drawRect(page, 620, 200, 720, 280);
  await page.locator('[data-testid^="layer-visible-"]').first().click(); // hide Notes
  await page.waitForTimeout(1300); // autosave

  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await openLayersPanel(page);
  await expect(page.locator('[data-testid^="layer-item-"]')).toHaveCount(2);
  await expect(page.locator('[data-testid^="layer-item-"]').first()).toHaveText("Notes");
  expect(await cursorAt(page, 620, 240)).toBe("default"); // still hidden after reload

  // Share: the viewer honors hidden layers and never shows the layers panel (view-only unmount).
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-share").click();
  await page.getByTestId("share-dialog-regenerate").click();
  const shareUrl = await page.getByTestId("share-dialog-link").inputValue();
  await page.goto(shareUrl);
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect(page.getByTestId("pages-toggle")).toBeVisible();
  await expect(page.getByTestId("layers-panel")).toHaveCount(0);
  // The menu toggle is registry-gated in view-only: clicking it must NOT summon the panel.
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-toggle-layers").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("layers-panel")).toHaveCount(0);
});
