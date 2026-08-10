import { test, expect } from "@playwright/test";

/**
 * Rich text (element-level bold/italic): toggles from the focused text panel and Cmd/Ctrl+B/I while
 * editing. Bold thickens the strokes (more ink); italic slants them. Whole-block styling keeps the
 * canvas/textarea WYSIWYG intact (covered by text-edit.spec's pixel-jump guard).
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("bold/italic toggles apply to a selected text and persist through commit/reselect", async ({ page }) => {
  // Place a text element and commit it.
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(400, 360);
  await page.getByTestId("text-editor-overlay-textarea").fill("Hello");
  await page.keyboard.press("Escape");

  // Select it → the focused text panel exposes B / I toggles, both off.
  await page.mouse.click(410, 366);
  await expect(page.getByTestId("properties-panel-text")).toBeVisible();
  await expect(page.getByTestId("text-bold")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("text-italic")).toHaveAttribute("aria-pressed", "false");

  await page.getByTestId("text-bold").click();
  await page.getByTestId("text-italic").click();
  await expect(page.getByTestId("text-bold")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("text-italic")).toHaveAttribute("aria-pressed", "true");

  // Deselect and reselect — the state is stored on the element, not just the panel.
  await page.keyboard.press("Escape");
  await page.mouse.click(410, 366);
  await expect(page.getByTestId("text-bold")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("text-italic")).toHaveAttribute("aria-pressed", "true");
});

test("Cmd/Ctrl+B toggles bold while editing and persists to the element", async ({ page }) => {
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(400, 360);
  await page.getByTestId("text-editor-overlay-textarea").fill("World");

  await page.keyboard.press("Control+b"); // bold on, still editing
  await page.keyboard.press("Escape");

  // Reselect → the bold state persisted on the element.
  await page.mouse.click(410, 366);
  await expect(page.getByTestId("text-bold")).toHaveAttribute("aria-pressed", "true");
});
