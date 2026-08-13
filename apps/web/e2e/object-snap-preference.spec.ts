import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * "Snap to objects" is a preference, off by default, so an ordinary drag tracks the pointer instead
 * of sticking to every neighbour's edges — the same default excalidraw.com ships.
 */

const AUTOSAVE_FLUSH_MS = 1300;
const NEIGHBOUR = { left: 600, top: 200, right: 720, bottom: 280 } as const;
const MOVER = { left: 585, top: 400, right: 705, bottom: 480 } as const;

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

/** The x of the last-created rectangle, once autosave has flushed. */
async function moverX(page: Page): Promise<number> {
  await page.waitForTimeout(AUTOSAVE_FLUSH_MS);
  return page.evaluate(() => {
    const scene = JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!) as { elements: Array<Record<string, unknown>> };
    const rects = scene.elements.filter((element) => element.type === "rectangle" && !element.isDeleted);
    return rects[rects.length - 1]!.x as number;
  });
}

/**
 * Drags the lower box right by `dx`, landing where an alignment band sits if snapping is on. Grabbed
 * from inside its bounding box rather than on an edge: every edge midpoint and corner carries a
 * resize handle, and grabbing one of those would resize instead of move.
 */
async function dragRight(page: Page, dx: number): Promise<void> {
  const grab = { x: 620, y: 440 };
  await page.getByTestId("toolbar-select-tool").click();
  await page.mouse.click(MOVER.left, MOVER.top); // select by its corner geometry first
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + dx / 2, grab.y);
  await page.mouse.move(grab.x + dx, grab.y);
  await page.mouse.up();
}

async function setUpTwoBoxes(page: Page): Promise<void> {
  await drawBox(page, NEIGHBOUR);
  await drawBox(page, MOVER);
  await page.keyboard.press("Escape");
}

test("by default a drag lands exactly where it was dragged, not on a neighbour's edge", async ({ page }) => {
  await setUpTwoBoxes(page);
  await dragRight(page, 17); // would be pulled onto the neighbour's left edge (600) if snapping were on

  expect(await moverX(page)).toBeCloseTo(MOVER.left + 17, 0);
});

test("the menu toggle turns snapping on, and then the same drag does align", async ({ page }) => {
  await setUpTwoBoxes(page);
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-toggle-object-snap").click();
  await page.keyboard.press("Escape");

  await dragRight(page, 17);
  expect(await moverX(page)).toBeCloseTo(NEIGHBOUR.left, 0);
});

test("Alt+S toggles it too, and the choice survives a reload", async ({ page }) => {
  await setUpTwoBoxes(page);
  await page.keyboard.press("Alt+s");
  await page.waitForTimeout(AUTOSAVE_FLUSH_MS); // let the scene reach localStorage before reloading
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  await dragRight(page, 17);
  expect(await moverX(page)).toBeCloseTo(NEIGHBOUR.left, 0);
});
