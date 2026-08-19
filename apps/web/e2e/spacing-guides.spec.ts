import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Equal-spacing (gap) snapping: dragging a shape between two others pulls it to equal gaps, and
 * dragging past an evenly spaced pair repeats that spacing. Rides the same "snap to objects"
 * preference as alignment snap, so every test here turns it on first.
 */

const AUTOSAVE_FLUSH_MS = 1300;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function drawBox(page: Page, box: { left: number; top: number; right: number; bottom: number }): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(box.left, box.top);
  await page.mouse.down();
  await page.mouse.move(box.right, box.bottom);
  await page.mouse.up();
}

async function enableObjectSnap(page: Page): Promise<void> {
  await page.keyboard.press("Alt+s");
}

/** Every non-deleted rectangle from the persisted scene, in creation order. */
async function rectangles(page: Page): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
  await page.waitForTimeout(AUTOSAVE_FLUSH_MS);
  return page.evaluate(() => {
    const scene = ((autosaved: unknown) => { const doc = autosaved as { pages?: Array<{ id: string; scene: unknown }>; activePageId?: string }; return doc.pages ? (doc.pages.find((entry) => entry.id === doc.activePageId) ?? doc.pages[0]!).scene : autosaved; })(JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!)) as { elements: Array<Record<string, unknown>> };
    return scene.elements
      .filter((element) => element.type === "rectangle" && !element.isDeleted)
      .map((element) => ({ x: element.x as number, y: element.y as number, width: element.width as number, height: element.height as number }));
  });
}

/**
 * Selects `box` and drags it right by `dx`, in two steps so the gesture sees intermediate moves.
 *
 * Selecting first, by its corner, is not optional: these rectangles have a transparent fill, so
 * their interior is not a hit target until the selection frame is around them. The drag itself then
 * grabs an interior point, away from the edge midpoints and corners that carry resize handles.
 */
async function dragBy(page: Page, box: { left: number; top: number; right: number; bottom: number }, dx: number): Promise<void> {
  await page.getByTestId("toolbar-select-tool").click();
  await page.mouse.click(box.left, box.top);
  const grab = { x: (box.left + box.right) / 2 + 8, y: (box.top + box.bottom) / 2 + 8 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + dx / 2, grab.y);
  await page.mouse.move(grab.x + dx, grab.y);
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

test("a shape dragged between two others snaps to equal gaps", async ({ page }) => {
  // Outer shapes at x 340..400 and 740..800, sharing a horizontal band. Kept clear of the left
  // toolbar and the right-hand panels, which would swallow the pointer.
  await drawBox(page, { left: 340, top: 300, right: 400, bottom: 380 });
  await drawBox(page, { left: 740, top: 300, right: 800, bottom: 380 });
  // The mover, drawn off the even-spacing position so the snap has something to correct.
  await drawBox(page, { left: 510, top: 300, right: 570, bottom: 380 });
  await page.keyboard.press("Escape");
  await enableObjectSnap(page);

  // Even spacing puts its left edge at 540 (gaps of 140 either side). Land 6px short of that.
  await dragBy(page, { left: 510, top: 300, right: 570, bottom: 380 }, 24);

  const boxes = await rectangles(page);
  const mover = boxes[2]!;
  const gapBefore = mover.x - 400;
  const gapAfter = 740 - (mover.x + mover.width);
  expect(Math.abs(gapBefore - gapAfter)).toBeLessThan(1);
});

test("dragging past an evenly spaced pair repeats that spacing", async ({ page }) => {
  // A pair with a 100px gap: 340..440 and 540..640.
  await drawBox(page, { left: 340, top: 300, right: 440, bottom: 380 });
  await drawBox(page, { left: 540, top: 300, right: 640, bottom: 380 });
  await drawBox(page, { left: 900, top: 300, right: 1000, bottom: 380 });
  await page.keyboard.press("Escape");
  await enableObjectSnap(page);

  // The next slot in the row starts at 740; land 5px short of it.
  await dragBy(page, { left: 900, top: 300, right: 1000, bottom: 380 }, -155);

  const boxes = await rectangles(page);
  const mover = boxes[2]!;
  expect(mover.x - 640).toBeCloseTo(100, 0);
});

test("shapes that do not share a band are never treated as a spacing", async ({ page }) => {
  await drawBox(page, { left: 340, top: 150, right: 400, bottom: 210 });
  await drawBox(page, { left: 740, top: 150, right: 800, bottom: 210 });
  // Far below the pair: correctly spaced on x, but these three are not a row.
  await drawBox(page, { left: 510, top: 480, right: 570, bottom: 540 });
  await page.keyboard.press("Escape");
  await enableObjectSnap(page);

  await dragBy(page, { left: 510, top: 480, right: 570, bottom: 540 }, 24);

  const boxes = await rectangles(page);
  // Landed exactly where it was dragged — no gap snap, and no alignment band at this x either.
  expect(boxes[2]!.x).toBeCloseTo(534, 0);
});

test("with snapping off, the same drag lands exactly where it was dragged", async ({ page }) => {
  await drawBox(page, { left: 340, top: 300, right: 400, bottom: 380 });
  await drawBox(page, { left: 740, top: 300, right: 800, bottom: 380 });
  await drawBox(page, { left: 510, top: 300, right: 570, bottom: 380 });
  await page.keyboard.press("Escape");

  await dragBy(page, { left: 510, top: 300, right: 570, bottom: 380 }, 24);

  expect((await rectangles(page))[2]!.x).toBeCloseTo(534, 0);
});
