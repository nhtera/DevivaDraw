import { test, expect } from "@playwright/test";

/**
 * The empty-canvas prompt: shown while the drawing is empty, gone the moment it isn't, and never in
 * the way of a gesture that starts on top of it.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("greets an empty canvas and clears itself as soon as something is drawn", async ({ page }) => {
  await expect(page.getByTestId("empty-state")).toBeVisible();

  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(500, 400);
  await page.mouse.down();
  await page.mouse.move(600, 480);
  await page.mouse.up();

  await expect(page.getByTestId("empty-state")).toHaveCount(0);
});

test("comes back when the drawing is emptied again", async ({ page }) => {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(500, 400);
  await page.mouse.down();
  await page.mouse.move(600, 480);
  await page.mouse.up();
  await expect(page.getByTestId("empty-state")).toHaveCount(0);

  await page.keyboard.press("Delete");
  await expect(page.getByTestId("empty-state")).toBeVisible();
});

test("a drag that starts on the prompt still draws — it never swallows a gesture", async ({ page }) => {
  const box = (await page.getByTestId("empty-state").boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 120, start.y + 90);
  await page.mouse.up();

  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
  await expect(page.getByTestId("empty-state")).toHaveCount(0);
});

test("steps aside while the first text element is being typed", async ({ page }) => {
  // Double-click creates a text draft that lives in the edit session, not the scene — the canvas is
  // still "empty" at that moment, so without the edit-session check the prompt would sit behind the caret.
  await page.mouse.dblclick(640, 420);
  await expect(page.getByTestId("text-editor-overlay-textarea")).toBeVisible();
  await expect(page.getByTestId("empty-state")).toHaveCount(0);

  await page.getByTestId("text-editor-overlay-textarea").fill("hello");
  await page.getByTestId("text-editor-overlay-textarea").press("Escape");
  await expect(page.getByTestId("empty-state")).toHaveCount(0); // the text is real now
});

test("zen mode hides it along with the rest of the chrome", async ({ page }) => {
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-toggle-zen-mode").click();
  await expect(page.getByTestId("empty-state")).toHaveCount(0);
});
