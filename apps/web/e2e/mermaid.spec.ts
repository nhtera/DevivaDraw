import { test, expect } from "@playwright/test";

/**
 * Mermaid to diagram (Excalidraw parity, no LLM): paste flowchart text, see a live preview, insert
 * editable shapes. Invalid/unsupported input shows an inline error and disables Insert.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("inserting a Mermaid flowchart creates selected, editable elements", async ({ page }) => {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-mermaid").click();
  await expect(page.getByTestId("mermaid-dialog")).toBeVisible();

  await page.getByTestId("mermaid-input").fill("flowchart TD\n A[One] --> B[Two]\n B --> C[Three]");
  // Live preview renders the parsed diagram before inserting.
  await expect(page.getByTestId("mermaid-preview")).toBeVisible();
  await expect(page.getByTestId("mermaid-insert")).toBeEnabled();
  await page.getByTestId("mermaid-insert").click();

  // The dialog closes and the generated diagram is on the canvas, selected (undoable).
  await expect(page.getByTestId("mermaid-dialog")).toHaveCount(0);
  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();

  // One undo removes the whole inserted diagram in a single step (it was one history batch).
  await page.getByTestId("top-bar-undo").click();
  await expect(page.locator('[data-testid^="layer-action-"]')).toHaveCount(0);
});

test("an unsupported diagram type shows an inline error and disables Insert", async ({ page }) => {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-mermaid").click();
  await expect(page.getByTestId("mermaid-dialog")).toBeVisible();

  await page.getByTestId("mermaid-input").fill('pie title Pets\n "Dogs": 3\n "Cats": 2');
  await expect(page.getByTestId("mermaid-error")).toBeVisible();
  await expect(page.getByTestId("mermaid-insert")).toBeDisabled();
});
