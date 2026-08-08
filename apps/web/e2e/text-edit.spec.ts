import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("places and edits a text element via the text tool", async ({ page }) => {
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(400, 350);

  const textarea = page.getByTestId("text-editor-overlay-textarea");
  await expect(textarea).toBeVisible();
  await textarea.fill("Hello Deviva Draw");
  await expect(textarea).toHaveValue("Hello Deviva Draw");

  // Plain Enter commits/exits the editor (see `should-commit-on-enter.ts`) and the text tool hands
  // control back to the select tool (see `text-tool.ts`'s `onPlaced` callback).
  await textarea.press("Enter");
  await expect(page.getByTestId("text-editor-overlay-textarea")).not.toBeVisible();
  await expect(page.getByTestId("toolbar-select-tool")).toHaveAttribute("aria-pressed", "true");

  // The committed text is a real, selectable scene element — undo is now available.
  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
});

test("Escape cancels an in-progress text edit without committing", async ({ page }) => {
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(400, 350);

  const textarea = page.getByTestId("text-editor-overlay-textarea");
  await expect(textarea).toBeVisible();
  await textarea.fill("Discarded draft");
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("text-editor-overlay-textarea")).not.toBeVisible();
});
