import { test, expect } from "@playwright/test";
import { AUTOSAVE_KEY, loadDeck, startPresenting, threeFrameDocument } from "./presentation-fixtures";

/**
 * What presentation mode must NOT allow: edits mid-talk, an escape hatch out of a view-only session,
 * leftover chrome state after exiting, or captured keys that stay captured.
 *
 * Split from `presentation.spec.ts` (which covers the walk itself) to keep both files inside the
 * house line limit — and these are the security-shaped guarantees, worth reading as a set.
 */

test("the board cannot be edited while presenting", async ({ page }) => {
  await loadDeck(page);
  await startPresenting(page);

  const elementCount = async () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).pages[0].scene.elements.filter((el: { isDeleted: boolean }) => !el.isDeleted).length, AUTOSAVE_KEY);
  const before = await elementCount();

  // A drag on the canvas mid-talk: with the laser tool active and view-only forced, this must leave
  // an ephemeral trail and nothing else. Double-click, which normally drops a text element on empty
  // canvas, must also be inert.
  await page.mouse.move(500, 400);
  await page.mouse.down();
  await page.mouse.move(700, 500, { steps: 6 });
  await page.mouse.up();
  await page.mouse.dblclick(600, 450);
  await expect(page.getByTestId("text-editor-overlay-textarea")).toHaveCount(0);

  await page.waitForTimeout(1300);
  expect(await elementCount()).toBe(before);
});

test("keyboard returns to normal after exiting — the presentation keys stop being captured", async ({ page }) => {
  await loadDeck(page);
  await startPresenting(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("toolbar-select-tool")).toBeVisible();

  // Typing into a text editor must work normally again, including the keys presentation had claimed.
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(600, 500);
  const textarea = page.getByTestId("text-editor-overlay-textarea");
  await expect(textarea).toBeVisible();
  await page.keyboard.type("hello there");
  await expect(textarea).toHaveValue("hello there");
});

test("the Present entry is disabled with no frames, and works with exactly one", async ({ page }) => {
  const emptyDoc = threeFrameDocument() as { pages: { scene: { elements: unknown[] } }[] };
  emptyDoc.pages[0]!.scene.elements = [];
  await loadDeck(page, emptyDoc);

  await page.getByTestId("top-bar-menu").click();
  await expect(page.getByTestId("main-menu-present")).toBeDisabled();
  await page.keyboard.press("Escape");

  const oneFrame = threeFrameDocument() as { pages: { scene: { elements: unknown[] } }[] };
  oneFrame.pages[0]!.scene.elements = [oneFrame.pages[0]!.scene.elements[1]!]; // just "1. First"
  await loadDeck(page, oneFrame);
  await startPresenting(page);

  await expect(page.getByTestId("presentation-counter")).toHaveText("1 / 1");
  await expect(page.getByTestId("presentation-prev")).toBeDisabled();
  await expect(page.getByTestId("presentation-next")).toBeDisabled();
});

test("presenting cannot be used to unlock a view-only session", async ({ page }) => {
  // Regression guard for a real escape found in review. `ui.getViewOnly()` is derived (the user's own
  // toggle OR presentation), but `setViewOnly` writes only the raw toggle — so `toggle-view-only`
  // running mid-presentation read `true` and wrote `false`, and the board became editable the moment
  // the presentation ended. On a view-only share link that silently defeated the whole point of it.
  await loadDeck(page);

  // Enter view-only, then present from inside it (both are legitimately allowed in view-only).
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-preferences").click();
  await page.getByTestId("main-menu-toggle-view-only").click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("toolbar-select-tool")).toHaveCount(0); // view-only: no toolbar

  await startPresenting(page);
  await page.keyboard.press("Alt+r"); // the escape attempt
  await page.keyboard.press("Escape"); // leave the presentation

  await expect(page.getByTestId("presentation-hud")).toHaveCount(0);
  // Still view-only: the toolbar must NOT be back.
  await expect(page.getByTestId("toolbar-select-tool")).toHaveCount(0);
});

test("Alt+Z cannot strand the user in zen mode after a presentation", async ({ page }) => {
  await loadDeck(page);
  await startPresenting(page);
  await page.keyboard.press("Alt+z");
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("presentation-hud")).toHaveCount(0);
  // Chrome fully restored — no leftover zen state from a keystroke that should have been inert.
  await expect(page.getByTestId("toolbar-select-tool")).toBeVisible();
  await expect(page.getByTestId("exit-zen-pill")).toHaveCount(0);
  await expect(page.getByTestId("library-toggle")).toBeVisible();
});
