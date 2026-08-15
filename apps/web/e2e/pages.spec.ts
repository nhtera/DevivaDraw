import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Multi-page documents: the bottom-left pages panel switches/adds/renames/deletes pages, content
 * stays isolated per page, the whole document (all pages + active) survives a reload through the
 * document autosave, and a legacy single-scene autosave loads as one page.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function drawRect(page: Page): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(400, 380);
  await page.mouse.up();
}

async function autosavedDocument(page: Page): Promise<{ type: string; activePageId?: string; pages: Array<{ id: string; name: string; scene: { elements: unknown[] } }> }> {
  await page.waitForTimeout(1300);
  return page.evaluate(() => JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!));
}

test("pages are added, isolated, switched, and autosaved as one document", async ({ page }) => {
  await drawRect(page);
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 1");

  // Add a page: it becomes active and starts empty (the rectangle stays behind on Page 1).
  await page.getByTestId("pages-toggle").click();
  await page.getByTestId("page-add").click();
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 2");
  await page.getByTestId("toolbar-ellipse-tool").click();
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(600, 380);
  await page.mouse.up();

  const doc = await autosavedDocument(page);
  expect(doc.type).toBe("devivadraw/document");
  expect(doc.pages).toHaveLength(2);
  expect(doc.pages[0]!.scene.elements.length).toBeGreaterThan(0);
  expect(doc.pages[1]!.scene.elements.length).toBe(1);
  expect(doc.activePageId).toBe(doc.pages[1]!.id);

  // Switch back: Page 1's content is on screen again (undo history is per-visit, selection panel off).
  await page.getByTestId("pages-toggle").click();
  await page.locator('[data-testid^="page-item-"]').first().click();
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 1");
});

test("the whole document, including the active page, survives a reload", async ({ page }) => {
  await drawRect(page);
  await page.getByTestId("pages-toggle").click();
  await page.getByTestId("page-add").click();
  await page.waitForTimeout(1300); // let the document autosave flush

  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 2");
  await page.getByTestId("pages-toggle").click();
  await expect(page.locator('[data-testid^="page-item-"]')).toHaveCount(2);
});

test("rename by double-click and delete with a neighbor taking over", async ({ page }) => {
  await page.getByTestId("pages-toggle").click();
  await page.getByTestId("page-add").click();
  // The popover stays open across page operations, so the new page is immediately renameable.
  const secondItem = page.locator('[data-testid^="page-item-"]').nth(1);
  await secondItem.dblclick();
  const renameInput = page.locator('[data-testid^="page-rename-"]');
  await renameInput.fill("Sketches");
  await renameInput.press("Enter");
  await expect(page.getByTestId("pages-active-name")).toHaveText("Sketches");

  // Delete the active page: its neighbor becomes active; the last page has no delete button.
  await page.locator('[data-testid^="page-delete-"]').nth(1).click();
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 1");
  await expect(page.locator('[data-testid^="page-delete-"]')).toHaveCount(0);
});

test("a legacy single-scene autosave loads as one page, nothing lost", async ({ page }) => {
  await drawRect(page);
  await page.waitForTimeout(1300);
  // Rewrite the slot to the legacy single-scene shape (what a pre-pages build wrote).
  await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!);
    localStorage.setItem("devivadraw:autosave:v1", JSON.stringify(doc.pages[0].scene));
  });
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 1");
  const doc = await autosavedDocument(page);
  expect(doc.pages ?? []).toHaveLength(0); // no edit yet — the slot still holds the legacy payload untouched
  await drawRect(page);
  const migrated = await autosavedDocument(page);
  expect(migrated.type).toBe("devivadraw/document");
  expect(migrated.pages[0]!.scene.elements.length).toBeGreaterThan(1);
});
