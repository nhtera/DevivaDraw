import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Flip horizontal / vertical (Excalidraw parity): mirrors the selection across its own bounding box,
 * from the context menu or Shift+H / Shift+V.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

/** Live elements from the persisted scene, in z-order. */
async function liveElements(page: Page): Promise<Array<{ type: string; x: number; y: number; points?: Array<{ x: number; y: number }> }>> {
  await page.waitForTimeout(1300); // autosave debounce
  return page.evaluate(() => {
    const raw = localStorage.getItem("devivadraw:autosave:v1");
    if (!raw) return [];
    const scene = JSON.parse(raw) as { elements: Array<{ type: string; x: number; y: number; isDeleted?: boolean; points?: Array<{ x: number; y: number }> }> };
    return scene.elements.filter((element) => !element.isDeleted);
  });
}

async function drawRect(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2);
  await page.mouse.up();
}

test("Shift+H swaps two shapes across the selection, and flipping twice restores them", async ({ page }) => {
  await drawRect(page, 300, 300, 360, 360);
  await drawRect(page, 600, 300, 660, 360);
  await page.getByTestId("toolbar-select-tool").click();
  await page.keyboard.press("Meta+a");

  const before = (await liveElements(page)).map((element) => element.x);
  await page.keyboard.press("Shift+H");
  const flipped = (await liveElements(page)).map((element) => element.x);

  // The left shape takes the right one's place and vice versa — the selection spans both, so each
  // lands where the other was.
  expect(flipped[0]).toBeCloseTo(before[1]!, 0);
  expect(flipped[1]).toBeCloseTo(before[0]!, 0);

  // A mirror is its own inverse.
  await page.keyboard.press("Shift+H");
  expect((await liveElements(page)).map((element) => element.x)).toEqual(before);
});

test("Shift+V mirrors a line's own geometry, not just its position", async ({ page }) => {
  await page.getByTestId("toolbar-line-tool").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(500, 400);
  await page.mouse.up();
  await page.getByTestId("toolbar-select-tool").click();
  await page.keyboard.press("Meta+a");

  const before = (await liveElements(page))[0]!;
  expect(before.points!.length).toBeGreaterThanOrEqual(2);
  const firstY = before.points![0]!.y;
  const lastY = before.points![before.points!.length - 1]!.y;

  await page.keyboard.press("Shift+V");

  // The line ran downhill; mirrored, its ends have swapped heights. A position-only flip would leave
  // the point list untouched.
  const after = (await liveElements(page))[0]!;
  expect(after.points![0]!.y).toBeCloseTo(lastY, 0);
  expect(after.points![after.points!.length - 1]!.y).toBeCloseTo(firstY, 0);
});

test("the context menu offers both flips, disabled with nothing selected", async ({ page }) => {
  await drawRect(page, 300, 300, 400, 400);
  await page.getByTestId("toolbar-select-tool").click();

  // Nothing selected: offered but unavailable, rather than missing.
  await page.mouse.click(700, 500);
  await page.mouse.click(700, 500, { button: "right" });
  await expect(page.getByTestId("context-menu-flip-horizontal")).toBeDisabled();
  await expect(page.getByTestId("context-menu-flip-vertical")).toBeDisabled();
  await page.keyboard.press("Escape");

  // With a single shape selected — flipping one element is the common case, so one is enough. The
  // rectangle is unfilled and unlabelled, so it is grabbed by its stroke: click the top edge, not the
  // hollow middle.
  await page.mouse.click(350, 300);
  await page.mouse.click(350, 300, { button: "right" });
  const flipHorizontal = page.getByTestId("context-menu-flip-horizontal");
  await expect(flipHorizontal).toBeEnabled();
  await expect(flipHorizontal).toContainText("H"); // the shortcut is shown, so the menu teaches it
});

test("flipping a block arrow turns it around", async ({ page }) => {
  await page.getByTestId("toolbar-more").click();
  await page.getByTestId("more-block-arrow-right-tool").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(440, 380);
  await page.mouse.up();
  await page.getByTestId("toolbar-select-tool").click();
  await page.keyboard.press("Meta+a");

  const direction = async () =>
    page.evaluate(() => {
      const scene = JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!) as { elements: Array<{ type: string; direction?: string; isDeleted?: boolean }> };
      return scene.elements.find((element) => element.type === "block-arrow" && !element.isDeleted)!.direction;
    });

  await page.waitForTimeout(1300);
  expect(await direction()).toBe("right");
  await page.keyboard.press("Shift+H");
  await page.waitForTimeout(1300);
  expect(await direction()).toBe("left");
});
