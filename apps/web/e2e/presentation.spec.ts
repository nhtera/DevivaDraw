import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { AUTOSAVE_KEY, deckDocument, frameElement, loadDeck, startPresenting } from "./presentation-fixtures";

/**
 * Presentation mode: frames walked as slides.
 *
 * The camera is the thing under test, so most assertions read the live camera out of the autosaved
 * document's parked viewport — which is also proof the walk moves the *real* camera rather than
 * painting a separate overlay view.
 */

/** The parked camera from the autosaved document (waits out the autosave debounce). */
async function parkedCamera(page: Page): Promise<{ scrollX: number; scrollY: number; zoom: number }> {
  await page.waitForTimeout(1300);
  return page.evaluate((key) => {
    const doc = JSON.parse(localStorage.getItem(key)!);
    return doc.pages[0].scene.appState;
  }, AUTOSAVE_KEY);
}

/** Waits for the slide-transition animation to settle. */
async function settleTransition(page: Page): Promise<void> {
  await page.waitForTimeout(600);
}

test("walks frames in numeric-prefix order, not scene order", async ({ page }) => {
  await loadDeck(page);
  await startPresenting(page);

  await expect(page.getByTestId("presentation-counter")).toHaveText("1 / 3");
  await expect(page.getByTestId("presentation-slide-name")).toHaveText("1. First");
  await settleTransition(page);
  const first = await parkedCamera(page);

  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("presentation-counter")).toHaveText("2 / 3");
  await expect(page.getByTestId("presentation-slide-name")).toHaveText("2. Second");
  await settleTransition(page);
  const second = await parkedCamera(page);

  // Frame 2 sits 1000 units right of frame 1, so the camera must have scrolled left to centre it.
  expect(second.scrollX).toBeLessThan(first.scrollX - 500);

  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("presentation-counter")).toHaveText("1 / 3");
  await settleTransition(page);
  expect((await parkedCamera(page)).scrollX).toBeCloseTo(first.scrollX, 0);
});

test("Space and PageDown/PageUp also navigate", async ({ page }) => {
  await loadDeck(page);
  await startPresenting(page);

  await page.keyboard.press(" ");
  await expect(page.getByTestId("presentation-counter")).toHaveText("2 / 3");
  await page.keyboard.press("PageDown");
  await expect(page.getByTestId("presentation-counter")).toHaveText("3 / 3");
  await page.keyboard.press("PageUp");
  await expect(page.getByTestId("presentation-counter")).toHaveText("2 / 3");
});

test("navigation stops at both ends instead of wrapping", async ({ page }) => {
  await loadDeck(page);
  await startPresenting(page);

  await expect(page.getByTestId("presentation-prev")).toBeDisabled();
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("presentation-counter")).toHaveText("3 / 3");
  await expect(page.getByTestId("presentation-next")).toBeDisabled();
});

test("the HUD buttons navigate and exit", async ({ page }) => {
  await loadDeck(page);
  await startPresenting(page);

  await page.getByTestId("presentation-next").click();
  await expect(page.getByTestId("presentation-counter")).toHaveText("2 / 3");
  await page.getByTestId("presentation-prev").click();
  await expect(page.getByTestId("presentation-counter")).toHaveText("1 / 3");

  await page.getByTestId("presentation-exit").click();
  await expect(page.getByTestId("presentation-hud")).toHaveCount(0);
});

test("presenting hides the editor chrome, and Escape restores every bit of it", async ({ page }) => {
  await loadDeck(page);
  await expect(page.getByTestId("toolbar-select-tool")).toBeVisible();
  await expect(page.getByTestId("top-bar-menu")).toBeVisible();

  await startPresenting(page);
  await expect(page.getByTestId("toolbar-select-tool")).toHaveCount(0);
  await expect(page.getByTestId("top-bar-menu")).toHaveCount(0);
  await expect(page.getByTestId("library-toggle")).toHaveCount(0);
  await expect(page.getByTestId("minimap")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("presentation-hud")).toHaveCount(0);
  await expect(page.getByTestId("toolbar-select-tool")).toBeVisible();
  await expect(page.getByTestId("top-bar-menu")).toBeVisible();
  await expect(page.getByTestId("library-toggle")).toBeVisible();
});

test("presenter notes are hidden until asked for, follow the slide, and never touch the canvas", async ({ page }) => {
  const deck = deckDocument([
    frameElement("f-a", "1. First", 0, "a001", "Open with the demo."),
    frameElement("f-b", "2. Second", 1000, "a002"),
  ]);
  await loadDeck(page, deck);
  await startPresenting(page);

  // Hidden by default — a deck with notes must not cost stage space until the presenter wants them.
  await expect(page.getByTestId("presenter-notes")).toBeHidden();

  await page.keyboard.press("n");
  await expect(page.getByTestId("presenter-notes")).toHaveText("Open with the demo.");

  // The strip follows the walk, and says so when the next slide carries nothing.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("presentation-counter")).toHaveText("2 / 2");
  await expect(page.getByTestId("presenter-notes")).toHaveText("No notes for this slide.");

  await page.keyboard.press("n");
  await expect(page.getByTestId("presenter-notes")).toBeHidden();
});

test("the HUD notes button toggles the same strip the N key does", async ({ page }) => {
  await loadDeck(page, deckDocument([frameElement("f-a", "1. First", 0, "a001", "Speak slowly.")]));
  await startPresenting(page);

  await page.getByTestId("presentation-notes-toggle").click();
  await expect(page.getByTestId("presenter-notes")).toHaveText("Speak slowly.");
  await page.keyboard.press("n");
  await expect(page.getByTestId("presenter-notes")).toBeHidden();
});

test("notes are authored from the properties panel and survive a reload", async ({ page }) => {
  await loadDeck(page, deckDocument([frameElement("f-a", "1. First", 0, "a001")]));

  // The same click `presentation-selection.spec.ts` uses to select this fixture's frame at the default camera.
  await page.mouse.click(400, 300);
  const notes = page.getByTestId("frame-notes");
  await expect(notes).toBeVisible();
  await notes.fill("Remember the numbers.");
  await notes.blur();

  await page.waitForTimeout(1300); // autosave debounce
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  await startPresenting(page);
  await page.keyboard.press("n");
  await expect(page.getByTestId("presenter-notes")).toHaveText("Remember the numbers.");
});
