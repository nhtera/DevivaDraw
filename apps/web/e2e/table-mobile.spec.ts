import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Mobile table editing: cell editing must be reachable by touch DOUBLE-TAP — iOS Safari never
 * synthesizes `dblclick` from double-taps, so the touch adapter's own tap detection (not the
 * desktop dblclick listener) is what these real-touch taps exercise end to end.
 */

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

/** Creates a ~2x2-reachable table via the More menu + a touch drag through the pointer pipeline. */
async function createTable(page: Page): Promise<void> {
  await page.getByTestId("toolbar-more").tap();
  await page.getByTestId("more-table-tool").tap();
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="deviva-draw-canvas-host"] canvas')!;
    const fire = (type: string, options: PointerEventInit) =>
      canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, button: 0, pointerType: "touch", ...options }));
    fire("pointerdown", { pointerId: 90, clientX: 40, clientY: 300 });
    fire("pointermove", { pointerId: 90, clientX: 350, clientY: 480 });
    fire("pointerup", { pointerId: 90, clientX: 350, clientY: 480 });
  });
}

/**
 * Double-taps until the editor appears (up to 3 attempts): the 350ms tap window is generous for a
 * human but a loaded CI worker can stretch the automation's two taps past it — a user would simply
 * tap again, so the test does too.
 */
async function doubleTapToEdit(page: Page, x: number, y: number): Promise<void> {
  const editor = page.getByTestId("table-cell-editor");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(60);
    await page.touchscreen.tap(x, y);
    const appeared = await editor.waitFor({ state: "visible", timeout: 700 }).then(() => true, () => false);
    if (appeared) return;
    await page.waitForTimeout(400); // let the tap window expire so the next pair starts fresh
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await createTable(page);
});

test("creating a table opens the first cell's editor, focused", async ({ page }) => {
  const editor = page.getByTestId("table-cell-editor");
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
});

test("double-tap edits a cell: type, commit, reopen shows the text", async ({ page }) => {
  const editor = page.getByTestId("table-cell-editor");
  await expect(editor).toBeVisible();
  await page.keyboard.press("Escape"); // close the auto-opened first cell
  await expect(editor).toHaveCount(0);

  await doubleTapToEdit(page, 250, 330); // a different cell (top row, so a content-refit resize cannot move it)
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  await page.keyboard.type("World");
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);

  await doubleTapToEdit(page, 250, 330);
  await expect(editor).toHaveValue("World");
  await page.keyboard.press("Escape");
});

test("a single tap selects without opening an editor", async ({ page }) => {
  await page.keyboard.press("Escape");
  await page.touchscreen.tap(250, 330);
  await page.waitForTimeout(450); // longer than the double-tap window
  await expect(page.getByTestId("table-cell-editor")).toHaveCount(0);
  await expect(page.getByTestId("mobile-properties-bar")).toBeVisible(); // selected ⇒ style bar shows
});
