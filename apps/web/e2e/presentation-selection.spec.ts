import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { deckDocument, frameElement, loadDeck, startPresenting } from "./presentation-fixtures";

/**
 * What the audience sees, and does not: selection handles.
 *
 * Selection is editor state, and presentation only hides chrome — so the interactive layer went on
 * drawing the outline and resize handles of whatever happened to be selected, over the first slide.
 * The natural flow all but guarantees hitting it: drawing a frame leaves that frame selected, and
 * the next thing a presenter does is press Present.
 *
 * Asserted on painted pixels rather than on internal state, because the pixels are the whole
 * complaint — the selection could be "cleared" in a store and still be on screen for a frame.
 */

/** Handle-blue pixels across every canvas layer: the selection outline and its resize handles. */
async function selectionBluePixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvases = document.querySelector('[data-testid="deviva-draw-canvas-host"]')!.querySelectorAll("canvas");
    let total = 0;
    for (const canvas of canvases) {
      const data = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b, a] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
        if (a > 100 && b > 180 && r < 120 && g > 90 && g < 190) total++;
      }
    }
    return total;
  });
}

/** One frame, selected — the state a presenter is in immediately after drawing it. */
async function selectTheFrame(page: Page): Promise<void> {
  await page.mouse.click(400, 300); // inside the frame's on-screen rect at the default camera
  await expect.poll(async () => await selectionBluePixels(page)).toBeGreaterThan(0);
}

test("selection handles are not painted over the slides", async ({ page }) => {
  await loadDeck(page, deckDocument([frameElement("f-1", "1. Only", 0, "a001")]));
  await selectTheFrame(page);

  await startPresenting(page);
  await page.waitForTimeout(700); // let the entry camera jump and a few frames paint

  expect(await selectionBluePixels(page)).toBe(0);
});

// Presentation picks the laser tool on entry, which is right for presenting and wrong to leave
// behind: the presenter returns to a board where their tool has silently changed, and the first
// click does something they did not ask for.
test("the tool comes back on exit", async ({ page }) => {
  await loadDeck(page, deckDocument([frameElement("f-1", "1. Only", 0, "a001")]));
  await page.getByTestId("toolbar-rectangle-tool").click();
  await expect(page.getByTestId("toolbar-rectangle-tool")).toHaveAttribute("aria-pressed", "true");

  await startPresenting(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("presentation-hud")).toHaveCount(0);

  await expect(page.getByTestId("toolbar-rectangle-tool")).toHaveAttribute("aria-pressed", "true");
});

// Clearing the selection was our doing, not the user's: someone who presents mid-edit should find
// the board as they left it.
test("the selection comes back on exit", async ({ page }) => {
  await loadDeck(page, deckDocument([frameElement("f-1", "1. Only", 0, "a001")]));
  await selectTheFrame(page);

  await startPresenting(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("presentation-hud")).toHaveCount(0);

  await expect.poll(async () => await selectionBluePixels(page)).toBeGreaterThan(0);
});
