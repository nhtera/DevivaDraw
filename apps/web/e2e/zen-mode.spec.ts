import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Zen mode as a reversible view preference, and the keyboard bindings for the four chrome toggles
 * (⌥Z zen, ⌥R view-only, ⌥/ properties panel, Q tool lock).
 *
 * The core guarantee under test is that zen is never a trap: the toolbar, top bar and a dedicated
 * exit pill survive it, so the mode round-trips with the mouse alone AND with the keyboard alone.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function openPreferencesFlyout(page: Page): Promise<void> {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-preferences").click();
  await expect(page.getByTestId("main-menu-preferences-flyout")).toBeVisible();
}

/** Enters zen through the menu, leaving no menu open behind it. */
async function enterZenViaMenu(page: Page): Promise<void> {
  await openPreferencesFlyout(page);
  await page.getByTestId("main-menu-toggle-zen-mode").click();
  await page.keyboard.press("Escape"); // flyout
  await page.keyboard.press("Escape"); // menu
  await expect(page.getByTestId("main-menu")).toHaveCount(0);
}

/** Matches a shortcut hint on either platform rendering — "⌥Z" on Mac, "Alt+Z" elsewhere. */
function shortcutHint(key: string): RegExp {
  return new RegExp(`(⌥|Alt\\+)${key}`);
}

test("zen keeps the toolbar, top bar and an exit pill; the pill exits with the mouse alone", async ({ page }) => {
  // A drawn element, not just an active tool: the minimap only renders once the scene has bounds.
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(300, 250);
  await page.mouse.down();
  await page.mouse.move(460, 360, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("properties-panel")).toBeVisible();
  await expect(page.getByTestId("minimap")).toBeVisible();

  await enterZenViaMenu(page);

  // Kept: everything the user reaches for next.
  await expect(page.getByTestId("toolbar-rectangle-tool")).toBeVisible();
  await expect(page.getByTestId("top-bar-menu")).toBeVisible();
  await expect(page.getByTestId("top-bar-zoom-percentage")).toBeVisible();
  await expect(page.getByTestId("exit-zen-pill")).toBeVisible();
  // Hidden: the panel-class chrome zen exists to clear away.
  await expect(page.getByTestId("properties-panel")).toHaveCount(0);
  await expect(page.getByTestId("minimap")).toHaveCount(0);
  await expect(page.getByTestId("library-toggle")).toHaveCount(0);

  await page.getByTestId("exit-zen-pill").click();
  await expect(page.getByTestId("exit-zen-pill")).toHaveCount(0);
  await expect(page.getByTestId("properties-panel")).toBeVisible();
  await expect(page.getByTestId("minimap")).toBeVisible();
});

test("Alt+Z round-trips zen with the keyboard alone", async ({ page }) => {
  await page.mouse.move(400, 300);
  await page.keyboard.press("Alt+z");
  await expect(page.getByTestId("exit-zen-pill")).toBeVisible();

  await page.keyboard.press("Alt+z");
  await expect(page.getByTestId("exit-zen-pill")).toHaveCount(0);
  await expect(page.getByTestId("top-bar-menu")).toBeVisible();
});

test("Escape does not exit zen — it stays the deselect/cancel key", async ({ page }) => {
  await page.keyboard.press("Alt+z");
  await expect(page.getByTestId("exit-zen-pill")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("exit-zen-pill")).toBeVisible();
});

test("Q toggles the tool lock and Alt+/ toggles the properties panel", async ({ page }) => {
  const lock = page.getByTestId("toolbar-lock");
  await expect(lock).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("q");
  await expect(lock).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("q");
  await expect(lock).toHaveAttribute("aria-pressed", "false");

  await page.getByTestId("toolbar-rectangle-tool").click();
  await expect(page.getByTestId("properties-panel")).toBeVisible();
  await page.keyboard.press("Alt+/");
  await expect(page.getByTestId("properties-panel")).toHaveCount(0);
  await page.keyboard.press("Alt+/");
  await expect(page.getByTestId("properties-panel")).toBeVisible();
});

test("Alt+R toggles view-only", async ({ page }) => {
  await expect(page.getByTestId("toolbar-rectangle-tool")).toBeVisible();
  await page.keyboard.press("Alt+r");
  await expect(page.getByTestId("toolbar-rectangle-tool")).toHaveCount(0);
  await page.keyboard.press("Alt+r");
  await expect(page.getByTestId("toolbar-rectangle-tool")).toBeVisible();
});

test("every chrome toggle row shows its shortcut in the preferences flyout", async ({ page }) => {
  await openPreferencesFlyout(page);
  await expect(page.getByTestId("main-menu-toggle-zen-mode")).toHaveText(shortcutHint("Z"));
  await expect(page.getByTestId("main-menu-toggle-view-only")).toHaveText(shortcutHint("R"));
  await expect(page.getByTestId("main-menu-toggle-properties-panel")).toHaveText(shortcutHint("/"));
  await expect(page.getByTestId("main-menu-toggle-tool-lock")).toHaveText(/Q/);
});

/**
 * Tablet tier gets its own case because it is the one place zen's behavior deliberately CHANGED
 * rather than merely relaxed: the bottom-left history/zoom island used to disappear with everything
 * else, and it must now survive — otherwise a coarse-pointer user in zen loses undo entirely, since
 * that tier has no top-bar copy of those controls.
 */
test.describe("tablet tier", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true });

  test("zen keeps the compact top bar and the bottom-left history/zoom island", async ({ page }) => {
    await expect(page.getByTestId("deviva-draw-root")).toHaveAttribute("data-dd-density", "touch");
    await expect(page.getByTestId("tablet-bottom-controls")).toBeVisible();

    await enterZenViaMenu(page);

    await expect(page.getByTestId("tablet-bottom-controls")).toBeVisible();
    await expect(page.getByTestId("top-bar-menu")).toBeVisible();
    await expect(page.getByTestId("toolbar-select-tool")).toBeVisible();
    await expect(page.getByTestId("exit-zen-pill")).toBeVisible();
    await expect(page.getByTestId("library-toggle")).toHaveCount(0);

    await page.getByTestId("exit-zen-pill").tap();
    await expect(page.getByTestId("exit-zen-pill")).toHaveCount(0);
    await expect(page.getByTestId("library-toggle")).toBeVisible();
  });
});

test("the new bare-letter bindings never fire while a text editor owns the keyboard", async ({ page }) => {
  // Regression guard for the v0.9.1 keystroke-leak class of bug: `.fill()` bypasses keydowns
  // entirely, so this must TYPE for the assertion to mean anything.
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(400, 350);
  const textarea = page.getByTestId("text-editor-overlay-textarea");
  await expect(textarea).toBeVisible();

  await page.keyboard.type("quiz");
  await expect(textarea).toHaveValue("quiz");
  await expect(page.getByTestId("exit-zen-pill")).toHaveCount(0);

  await textarea.press("Escape");
  await expect(page.getByTestId("toolbar-lock")).toHaveAttribute("aria-pressed", "false");
});

test("the new bare-letter bindings never fire while a table cell editor owns the keyboard", async ({ page }) => {
  await page.getByTestId("toolbar-more").click();
  await page.getByTestId("more-table-tool").click();
  await page.mouse.click(650, 350);
  const editor = page.getByTestId("table-cell-editor");
  await expect(editor).toBeFocused();

  await page.keyboard.type("quiz");
  await expect(editor).toHaveValue("quiz");
  await expect(page.getByTestId("exit-zen-pill")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("toolbar-lock")).toHaveAttribute("aria-pressed", "false");
});
