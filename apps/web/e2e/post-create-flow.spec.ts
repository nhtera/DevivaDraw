import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Post-creation interaction model (matching Excalidraw/tldraw): after drawing, control returns to the
 * select tool and the new element is selected — unless the tool lock is engaged. Plus double-click
 * affordances: empty canvas creates text, a shape gets bound text.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function dragRect(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2);
  await page.mouse.move(x2, y2);
  await page.mouse.up();
}

test("drawing a shape switches back to the select tool and selects the new element", async ({ page }) => {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await dragRect(page, 300, 300, 480, 420);

  await expect(page.getByTestId("toolbar-select-tool")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("toolbar-rectangle-tool")).toHaveAttribute("aria-pressed", "false");
  // The Layer actions render only when a selection exists → the new rectangle is selected.
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();
});

test("drawing a line by dragging also hands back to select and selects the line", async ({ page }) => {
  await page.getByTestId("toolbar-line-tool").click();
  await dragRect(page, 260, 460, 520, 500);
  await expect(page.getByTestId("toolbar-select-tool")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();
});

test("the tool lock keeps the drawing tool active after drawing (no auto-switch)", async ({ page }) => {
  await page.getByTestId("toolbar-lock").click();
  await expect(page.getByTestId("toolbar-lock")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("toolbar-rectangle-tool").click();
  await dragRect(page, 300, 300, 460, 400);

  await expect(page.getByTestId("toolbar-rectangle-tool")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("toolbar-select-tool")).toHaveAttribute("aria-pressed", "false");
});

test("double-clicking empty canvas creates a new text element", async ({ page }) => {
  await page.mouse.dblclick(650, 380);
  const textarea = page.getByTestId("text-editor-overlay-textarea");
  await expect(textarea).toBeVisible();
  await textarea.fill("hello");
  await textarea.press("Escape"); // Escape commits (Enter is a newline now)
  await expect(page.getByTestId("text-editor-overlay-textarea")).not.toBeVisible();
  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
});

test("double-clicking a just-drawn shape inserts bound text (reachable immediately after drawing)", async ({ page }) => {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await dragRect(page, 300, 300, 520, 440);
  // Post-draw we're already in the select tool, so double-clicking the shape body opens bound-text editing.
  await page.mouse.dblclick(410, 370);
  await expect(page.getByTestId("text-editor-overlay-textarea")).toBeVisible();
});
