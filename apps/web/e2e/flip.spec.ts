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
    const scene = ((autosaved: unknown) => { const doc = autosaved as { pages?: Array<{ id: string; scene: unknown }>; activePageId?: string }; return doc.pages ? (doc.pages.find((entry) => entry.id === doc.activePageId) ?? doc.pages[0]!).scene : autosaved; })(JSON.parse(raw)) as { elements: Array<{ type: string; x: number; y: number; isDeleted?: boolean; points?: Array<{ x: number; y: number }> }> };
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

test("the context menu offers both flips for a selected element, and neither on empty canvas", async ({ page }) => {
  await drawRect(page, 300, 300, 400, 400);
  await page.getByTestId("toolbar-select-tool").click();

  // Nothing selected on empty canvas: the canvas menu opens instead, which has no element actions.
  await page.mouse.click(700, 500);
  await page.mouse.click(700, 500, { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await expect(page.getByTestId("context-menu-flip-horizontal")).toHaveCount(0);
  await expect(page.getByTestId("context-menu-flip-vertical")).toHaveCount(0);
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

test("an asymmetric shape really mirrors, on screen and not just in the data", async ({ page }) => {
  // A check-box: its tick runs low-left to high-right, so it is symmetric about neither axis and no
  // rotation can stand in for a mirror. Before mirroring was recorded on the element, flipping one
  // was a visible no-op.
  await page.getByTestId("toolbar-more").click();
  await page.getByTestId("more-check-box-tool").click();
  await page.mouse.move(340, 250);
  await page.mouse.down();
  await page.mouse.move(490, 380);
  await page.mouse.up();
  await page.getByTestId("toolbar-select-tool").click();
  await page.mouse.click(900, 600); // drop the selection so its frame is not in the pixels below

  /**
   * Where the tick's elbow sits across the box, as a 0..1 fraction. The check path runs low-left to
   * high-right, so its lowest point is well off-centre (about 0.43 of the width) — and its mirror is
   * about 0.57. A centre-of-mass measure would not do: the tick's own centroid sits near the middle,
   * so it reads the same mirrored or not.
   */
  const tickElbowX = async (): Promise<number> => {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
    return page.evaluate(() => {
      const canvas = [...document.querySelector('[data-testid="deviva-draw-canvas-host"]')!.querySelectorAll("canvas")][0]!;
      const ctx = canvas.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;
      // Strictly inside the drawn box (340,250)-(490,380), so its own border never counts as ink.
      const left = Math.round(350 * dpr);
      const top = Math.round(262 * dpr);
      const width = Math.round(130 * dpr);
      const height = Math.round(106 * dpr);
      const d = ctx.getImageData(left, top, width, height).data;

      let lowestRow = -1;
      const xs: number[] = [];
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3]! <= 60 || d[i]! >= 120) continue;
        const pixel = i / 4;
        const row = Math.floor(pixel / width);
        if (row > lowestRow) {
          lowestRow = row;
          xs.length = 0;
        }
        if (row === lowestRow) xs.push(pixel % width);
      }
      return xs.length === 0 ? -1 : xs.reduce((sum, x) => sum + x, 0) / xs.length / width;
    });
  };

  const before = await tickElbowX();
  expect(before).toBeGreaterThan(0.3);
  expect(before).toBeLessThan(0.5); // the elbow starts left of centre
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Shift+H");
  await page.mouse.click(900, 600);

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = localStorage.getItem("devivadraw:autosave:v1"); // written on a debounce
        if (!raw) return undefined;
        const scene = ((autosaved: unknown) => { const doc = autosaved as { pages?: Array<{ id: string; scene: unknown }>; activePageId?: string }; return doc.pages ? (doc.pages.find((entry) => entry.id === doc.activePageId) ?? doc.pages[0]!).scene : autosaved; })(JSON.parse(raw)) as { elements: Array<{ type: string; scale?: number[]; isDeleted?: boolean }> };
        return scene.elements.find((element) => element.type === "check-box" && !element.isDeleted)?.scale;
      }),
    )
    .toEqual([-1, 1]);

  // The elbow has crossed to the other side of the box — the mirror reached the canvas, not just the
  // stored field. Mirroring about the centre reflects it to (1 - before).
  const after = await tickElbowX();
  expect(after).toBeGreaterThan(0.5);
  expect(after).toBeCloseTo(1 - before, 1);
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
      const scene = ((autosaved: unknown) => { const doc = autosaved as { pages?: Array<{ id: string; scene: unknown }>; activePageId?: string }; return doc.pages ? (doc.pages.find((entry) => entry.id === doc.activePageId) ?? doc.pages[0]!).scene : autosaved; })(JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!)) as { elements: Array<{ type: string; direction?: string; isDeleted?: boolean }> };
      return scene.elements.find((element) => element.type === "block-arrow" && !element.isDeleted)!.direction;
    });

  await page.waitForTimeout(1300);
  expect(await direction()).toBe("right");
  await page.keyboard.press("Shift+H");
  await page.waitForTimeout(1300);
  expect(await direction()).toBe("left");
});
