import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Editing a selected arrow by its points: hollow endpoint handles instead of a resize box, a
 * midpoint dot on hover, and dragging an endpoint to re-attach or detach it.
 */

const AUTOSAVE_FLUSH_MS = 1300;
const BOX_A = { left: 330, top: 300, right: 450, bottom: 420 } as const;
const BOX_B = { left: 700, top: 300, right: 820, bottom: 420 } as const;
const BOX_C = { left: 700, top: 520, right: 820, bottom: 620 } as const;
/**
 * The arrow runs between A and B at their shared mid-height, drawn close enough to each box to bind
 * (the bind budget is 15 scene units at 100% zoom). Once bound, each endpoint is clipped back to its
 * target's outline plus the stroke gap, which is where the handles then sit — hence the separate
 * `HANDLE` positions.
 */
const ARROW = { fromX: 460, toX: 690, y: 360 } as const;
const HANDLE = { fromX: 456, toX: 694, y: 360 } as const;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function drag(page: Page, from: readonly [number, number], to: readonly [number, number]): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  await page.mouse.move(to[0], to[1]);
  await page.mouse.up();
}

async function storedArrow(page: Page) {
  await page.waitForTimeout(AUTOSAVE_FLUSH_MS);
  return page.evaluate(() => {
    const raw = localStorage.getItem("devivadraw:autosave:v1")!;
    const scene = JSON.parse(raw) as { elements: Array<Record<string, unknown>> };
    return scene.elements.find((element) => element.type === "arrow" && !element.isDeleted)!;
  });
}

/** Draws two rectangles and an arrow between them, leaving the arrow selected. */
async function drawScene(page: Page): Promise<void> {
  for (const box of [BOX_A, BOX_B]) {
    await page.getByTestId("toolbar-rectangle-tool").click();
    await drag(page, [box.left, box.top], [box.right, box.bottom]);
  }
  await page.getByTestId("toolbar-arrow-tool").click();
  await drag(page, [ARROW.fromX, ARROW.y], [ARROW.toX, ARROW.y]);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
}

/**
 * Counts overlay pixels matching the handles' indigo near `point`. `minAlpha` is a parameter because
 * the two handles differ: the vertex circles are opaque, the insert-a-bend dot is deliberately
 * translucent (0.35), so an opaque-only filter would never see it.
 */
async function handleInkNear(page: Page, point: { x: number; y: number }, radius = 16, minAlpha = 150): Promise<number> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
  return page.evaluate(
    ({ x, y, radius, minAlpha }) => {
      const canvases = [...document.querySelectorAll('[data-testid="deviva-draw-canvas-host"] canvas')] as HTMLCanvasElement[];
      const overlay = canvases[canvases.length - 1]!;
      const ratio = overlay.width / overlay.clientWidth;
      const data = overlay.getContext("2d")!.getImageData((x - radius) * ratio, (y - radius) * ratio, radius * 2 * ratio, radius * 2 * ratio).data;
      let hits = 0;
      for (let i = 0; i < data.length; i += 4) {
        // #6965db, the handle stroke — distinct from the selection frame's #1971c2.
        if (data[i + 3]! > minAlpha && Math.abs(data[i]! - 105) < 30 && Math.abs(data[i + 1]! - 101) < 30 && Math.abs(data[i + 2]! - 219) < 30) hits += 1;
      }
      return hits;
    },
    { x: point.x, y: point.y, radius, minAlpha },
  );
}

test("a selected arrow shows endpoint handles instead of a resize box", async ({ page }) => {
  await drawScene(page);

  // Handles on both stored endpoints...
  expect(await handleInkNear(page, { x: HANDLE.fromX, y: HANDLE.y })).toBeGreaterThan(0);
  expect(await handleInkNear(page, { x: HANDLE.toX, y: HANDLE.y })).toBeGreaterThan(0);
  // ...and nothing above the arrow, where a bbox frame's top edge and its handles would sit.
  expect(await handleInkNear(page, { x: (HANDLE.fromX + HANDLE.toX) / 2, y: HANDLE.y - 40 })).toBe(0);
});

test("hovering the middle of a segment fades in the insert-a-bend dot", async ({ page }) => {
  await drawScene(page);
  const middle = { x: (HANDLE.fromX + HANDLE.toX) / 2, y: HANDLE.y };

  await page.mouse.move(middle.x, middle.y - 60); // away from the arrow
  expect(await handleInkNear(page, middle, 8, 40)).toBe(0);

  await page.mouse.move(middle.x, middle.y);
  expect(await handleInkNear(page, middle, 8, 40)).toBeGreaterThan(0);
});

test("dragging an endpoint onto another shape re-attaches it, and that shape then drags the arrow", async ({ page }) => {
  await drawScene(page);
  await page.getByTestId("toolbar-rectangle-tool").click();
  await drag(page, [BOX_C.left, BOX_C.top], [BOX_C.right, BOX_C.bottom]);

  // Re-select the arrow, then drag its end handle down onto the third box.
  await page.getByTestId("toolbar-select-tool").click();
  await page.mouse.click((HANDLE.fromX + HANDLE.toX) / 2, HANDLE.y);
  await drag(page, [HANDLE.toX, HANDLE.y], [BOX_C.left - 4, 560]);

  const bound = await storedArrow(page);
  expect(bound.endBinding).not.toBeNull();

  // Moving the new target drags the arrow's endpoint with it.
  const endBefore = (bound.points as Array<{ x: number; y: number }>).at(-1)!;
  const yBefore = (bound.y as number) + endBefore.y;

  // An unfilled rectangle is grabbed by its stroke, not its interior — click the top edge.
  await page.mouse.click(760, BOX_C.top);
  await drag(page, [760, BOX_C.top], [760, BOX_C.top + 70]);

  const after = await storedArrow(page);
  const endAfter = (after.points as Array<{ x: number; y: number }>).at(-1)!;
  expect((after.y as number) + endAfter.y).toBeGreaterThan(yBefore);
});

test("dragging an endpoint into empty space detaches it", async ({ page }) => {
  await drawScene(page);
  expect((await storedArrow(page)).endBinding).not.toBeNull();

  await page.getByTestId("toolbar-select-tool").click();
  await page.mouse.click((HANDLE.fromX + HANDLE.toX) / 2, HANDLE.y);
  await drag(page, [HANDLE.toX, HANDLE.y], [600, 620]); // empty canvas

  expect((await storedArrow(page)).endBinding).toBeNull();
});

test("dragging a segment's midpoint inserts a bend and curves the arrow", async ({ page }) => {
  await drawScene(page);
  const middle = { x: (HANDLE.fromX + HANDLE.toX) / 2, y: HANDLE.y };

  await page.mouse.move(middle.x, middle.y); // bring the dot up
  await drag(page, [middle.x, middle.y], [middle.x, middle.y + 90]);

  const arrow = await storedArrow(page);
  expect(arrow.points).toHaveLength(3);
  expect(arrow.arrowType).toBe("curved");
});

test("selecting the arrow together with a shape brings the bbox frame back", async ({ page }) => {
  await drawScene(page);
  await page.getByTestId("toolbar-select-tool").click();
  await page.mouse.click((HANDLE.fromX + HANDLE.toX) / 2, HANDLE.y);
  await page.keyboard.down("Shift");
  await page.mouse.click((BOX_A.left + BOX_A.right) / 2, BOX_A.top); // its stroke, not its interior
  await page.keyboard.up("Shift");

  // The union frame's top edge runs above both, where the arrow-only overlay drew nothing.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
  const frameInk = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll('[data-testid="deviva-draw-canvas-host"] canvas')] as HTMLCanvasElement[];
    const overlay = canvases[canvases.length - 1]!;
    const data = overlay.getContext("2d")!.getImageData(0, 0, overlay.width, overlay.height).data;
    let hits = 0;
    for (let i = 0; i < data.length; i += 4) {
      // #1971c2 — the selection frame, which a lone arrow never draws.
      if (data[i + 3]! > 150 && Math.abs(data[i]! - 25) < 30 && Math.abs(data[i + 1]! - 113) < 30 && Math.abs(data[i + 2]! - 194) < 30) hits += 1;
    }
    return hits;
  });
  expect(frameInk).toBeGreaterThan(0);
});
