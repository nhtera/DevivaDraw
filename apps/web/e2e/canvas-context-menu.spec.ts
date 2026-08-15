import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The context menu is context-aware: right-clicking an element (or inside the selection) opens the
 * element menu — selecting the element first if needed — while right-clicking empty canvas opens a
 * canvas menu (paste / select all / canvas-preference toggles). The grid toggle it carries is also
 * reachable from the main menu and `Cmd+'`, renders a dot grid, and survives a reload.
 */

const RECT = { left: 300, top: 300, right: 420, bottom: 380 } as const;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function drawRect(page: Page): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(RECT.left, RECT.top);
  await page.mouse.down();
  await page.mouse.move(RECT.right, RECT.bottom);
  await page.mouse.up();
}

test("empty canvas gets the canvas menu; an element's stroke gets the element menu and selects it", async ({ page }) => {
  await drawRect(page);
  await page.getByTestId("toolbar-select-tool").click();
  await page.mouse.click(700, 520); // deselect

  // Empty canvas: canvas actions only.
  await page.mouse.click(700, 520, { button: "right" });
  await expect(page.getByTestId("context-menu-select-all")).toBeVisible();
  await expect(page.getByTestId("context-menu-toggle-grid")).toBeVisible();
  await expect(page.getByTestId("context-menu-duplicate")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The unselected rectangle's stroke: element menu, and the right-click itself selected it —
  // duplicate is enabled, which requires a selection.
  await page.mouse.click(RECT.left, RECT.top + 40, { button: "right" });
  await expect(page.getByTestId("context-menu-duplicate")).toBeEnabled();
  await page.keyboard.press("Escape");

  // Now that it is selected, its hollow interior counts as "inside the selection" too.
  await page.mouse.click((RECT.left + RECT.right) / 2, (RECT.top + RECT.bottom) / 2, { button: "right" });
  await expect(page.getByTestId("context-menu-duplicate")).toBeVisible();
});

/** Counts dark grid-dot pixels in an element-free region of the static canvas. */
async function gridInk(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="deviva-draw-canvas-host"] canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const img = ctx.getImageData(Math.round(600 * dpr), Math.round(500 * dpr), Math.round(150 * dpr), Math.round(150 * dpr)).data;
    let ink = 0;
    for (let i = 0; i < img.length; i += 4) {
      if (img[i]! < 240 && img[i + 3]! > 0) ink += 1;
    }
    return ink;
  });
}

test("grid toggles from the canvas menu, from Cmd+', and persists across reload", async ({ page }) => {
  expect(await gridInk(page)).toBe(0);

  await page.mouse.click(700, 520, { button: "right" });
  await page.getByTestId("context-menu-toggle-grid").click();
  await expect.poll(() => gridInk(page)).toBeGreaterThan(0);

  // Reload: the preference (its own key, not the scene autosave) brings the grid back.
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect.poll(() => gridInk(page)).toBeGreaterThan(0);

  // The shortcut turns it back off, and the main menu row reflects the state.
  await page.keyboard.press("Meta+'");
  await expect.poll(() => gridInk(page)).toBe(0);
  await page.getByTestId("top-bar-menu").click();
  await expect(page.getByTestId("main-menu-toggle-grid")).toHaveAttribute("aria-checked", "false");
});

test("unlock all frees a locked element that clicks can no longer reach", async ({ page }) => {
  await drawRect(page); // auto-selected
  await page.mouse.click(RECT.left, RECT.top + 40, { button: "right" });
  await page.getByTestId("context-menu-toggle-lock").click();

  // Deselect, then right-click the locked element's stroke: locked elements no longer hit-test, so
  // the click falls through to the canvas menu, where the escape hatch lives.
  await page.mouse.click(700, 520);
  await page.mouse.click(RECT.left, RECT.top + 40, { button: "right" });
  const unlockAll = page.getByTestId("context-menu-unlock-all");
  await expect(unlockAll).toBeEnabled();
  await unlockAll.click();

  // Unlocked and selected again — and with nothing locked left, the action goes disabled.
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();
  await page.mouse.click(700, 520);
  await page.mouse.click(700, 520, { button: "right" });
  await expect(page.getByTestId("context-menu-unlock-all")).toBeDisabled();
});

test("copy as SVG puts the scene's SVG markup on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await drawRect(page);
  await page.keyboard.press("Escape");

  await page.mouse.click(700, 520, { button: "right" });
  await page.getByTestId("context-menu-copy-as-svg").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("<svg");
});

test("? opens the keyboard-shortcuts dialog, but not while typing", async ({ page }) => {
  await page.keyboard.press("Shift+?");
  await expect(page.getByTestId("shortcuts-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shortcuts-dialog")).toHaveCount(0);

  // Inside a text edit, "?" is just a character.
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(500, 500);
  await page.keyboard.type("what?");
  await expect(page.getByTestId("shortcuts-dialog")).toHaveCount(0);
});
