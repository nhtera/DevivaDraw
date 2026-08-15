import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Pointer-cursor affordances: the select tool telegraphs move/resize/rotate under the pointer, the
 * hand tool shows grab, and creation tools show the crosshair — the canvas is never a mute default
 * arrow over draggable content.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

/** The cursor is applied by the render loop one frame after the hover lands, so poll rather than read once. */
async function expectCursorAt(page: Page, x: number, y: number, cursor: string): Promise<void> {
  await page.mouse.move(x, y);
  await expect
    .poll(() => page.getByTestId("deviva-draw-canvas-host").evaluate((host) => (host as HTMLElement).style.cursor))
    .toBe(cursor);
}

test("the select tool telegraphs move, resize, and rotate under the pointer", async ({ page }) => {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(400, 380);
  await page.mouse.up(); // auto-selected, back on the select tool

  await expectCursorAt(page, 350, 340, "move"); // inside the selection frame
  await expectCursorAt(page, 406, 386, "nwse-resize"); // se handle (bounds inflated 6px)
  await expectCursorAt(page, 350, 266, "grab"); // rotate handle, 28px above the inflated top edge
  await expectCursorAt(page, 600, 500, "default"); // empty canvas
});

test("hand and creation tools set grab and crosshair", async ({ page }) => {
  await page.keyboard.press("h");
  await expectCursorAt(page, 400, 300, "grab");
  await page.keyboard.press("r");
  await expectCursorAt(page, 410, 310, "crosshair");
  await page.keyboard.press("t");
  await expectCursorAt(page, 420, 320, "text");
});
