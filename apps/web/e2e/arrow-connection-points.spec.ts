import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The "where can this arrow attach" affordances, checked against excalidraw.com's own behaviour:
 * aiming anywhere at a shape attaches to it, each highlighted shape marks its four connection
 * anchors with a grey dot, and an endpoint released on a dot snaps to it exactly.
 */

const AUTOSAVE_FLUSH_MS = 1300;
/** Deliberately large, so its centre is nowhere near the band around its outline. */
const BOX = { left: 560, top: 240, right: 900, bottom: 560 } as const;
const CENTRE = { x: (BOX.left + BOX.right) / 2, y: (BOX.top + BOX.bottom) / 2 } as const;
/** The middle of the box's left edge — the anchor an arrow arriving from the left aims at. */
const LEFT_ANCHOR = { x: BOX.left, y: CENTRE.y } as const;

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

/**
 * Whether the overlay canvas paints an anchor dot's grey near `point`. Matched against
 * `rgba(105,105,105,0.9)`: nothing else on the interactive layer is neutral grey — the halo is light
 * blue, the selection frame `#1971c2`, the arrow handles indigo.
 */
async function hasAnchorDotNear(page: Page, point: { x: number; y: number }): Promise<boolean> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
  return page.evaluate(({ x, y }) => {
    const canvases = [...document.querySelectorAll('[data-testid="deviva-draw-canvas-host"] canvas')] as HTMLCanvasElement[];
    const overlay = canvases[canvases.length - 1]!; // the interactive layer is stacked last
    const ratio = overlay.width / overlay.clientWidth;
    const ctx = overlay.getContext("2d")!;
    const RADIUS = 8;
    const data = ctx.getImageData((x - RADIUS) * ratio, (y - RADIUS) * ratio, RADIUS * 2 * ratio, RADIUS * 2 * ratio).data;
    const TOLERANCE = 24;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 180) continue; // ignore antialiased fringes
      const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
      const isNeutral = Math.abs(r - g) <= 6 && Math.abs(g - b) <= 6;
      if (isNeutral && Math.abs(r - 105) <= TOLERANCE) return true;
    }
    return false;
  }, point);
}

/** Draws the box and deselects it, so no selection frame lands in a sampled region. */
async function drawBox(page: Page): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await drag(page, [BOX.left, BOX.top], [BOX.right, BOX.bottom]);
  await page.keyboard.press("Escape");
  await page.mouse.click(200, 680);
}

test("an arrow released deep inside a shape attaches to it", async ({ page }) => {
  await drawBox(page);
  await page.getByTestId("toolbar-arrow-tool").click();
  await drag(page, [320, CENTRE.y], [CENTRE.x, CENTRE.y]);

  const arrow = await storedArrow(page);
  expect(arrow.arrowType).toBe("straight");
  expect(arrow.endBinding).not.toBeNull();
});

test("hovering a shape with the arrow tool marks its four connection anchors", async ({ page }) => {
  await drawBox(page);
  await page.getByTestId("toolbar-arrow-tool").click();
  await page.mouse.move(CENTRE.x, CENTRE.y);

  for (const anchor of [
    { x: CENTRE.x, y: BOX.top },
    { x: BOX.right, y: CENTRE.y },
    { x: CENTRE.x, y: BOX.bottom },
    LEFT_ANCHOR,
  ]) {
    expect(await hasAnchorDotNear(page, anchor)).toBe(true);
  }
});

test("the anchors disappear once the pointer leaves every bindable shape", async ({ page }) => {
  await drawBox(page);
  await page.getByTestId("toolbar-arrow-tool").click();
  await page.mouse.move(CENTRE.x, CENTRE.y);
  expect(await hasAnchorDotNear(page, LEFT_ANCHOR)).toBe(true);

  await page.mouse.move(200, 680);
  expect(await hasAnchorDotNear(page, LEFT_ANCHOR)).toBe(false);
});

test("an endpoint released near an anchor snaps onto it", async ({ page }) => {
  await drawBox(page);
  await page.getByTestId("toolbar-arrow-tool").click();
  // Released a few pixels below the left anchor — inside the snap radius, so it should land on it.
  await drag(page, [300, LEFT_ANCHOR.y + 7], [LEFT_ANCHOR.x - 3, LEFT_ANCHOR.y + 7]);

  const arrow = await storedArrow(page);
  expect(arrow.endBinding).not.toBeNull();
  const points = arrow.points as Array<{ x: number; y: number }>;
  const endY = (arrow.y as number) + points.at(-1)!.y;
  expect(Math.abs(endY - LEFT_ANCHOR.y)).toBeLessThan(1.5);
});

test("an endpoint released between anchors stays where it was put", async ({ page }) => {
  await drawBox(page);
  await page.getByTestId("toolbar-arrow-tool").click();
  const wellBelowAnchor = LEFT_ANCHOR.y + 90;
  await drag(page, [300, wellBelowAnchor], [LEFT_ANCHOR.x - 3, wellBelowAnchor]);

  const arrow = await storedArrow(page);
  expect(arrow.endBinding).not.toBeNull();
  const points = arrow.points as Array<{ x: number; y: number }>;
  const endY = (arrow.y as number) + points.at(-1)!.y;
  expect(Math.abs(endY - wellBelowAnchor)).toBeLessThan(6); // near where it was dropped, not at the anchor
});

test("an endpoint snapped to an anchor stays on it after the shape is moved", async ({ page }) => {
  await drawBox(page);
  await page.getByTestId("toolbar-arrow-tool").click();
  // Start the arrow *on* the left anchor's dot and draw away to the upper left.
  await drag(page, [LEFT_ANCHOR.x, LEFT_ANCHOR.y], [200, 120]);
  await page.getByTestId("toolbar-select-tool").click();

  // Grab the box by its top stroke (its fill is transparent, so the interior is not a grab target)
  // well clear of the edge-midpoint resize handle, and drag it down and to the right.
  const MOVE = { dx: 90, dy: 110 };
  await drag(page, [BOX.left + 60, BOX.top], [BOX.left + 60 + MOVE.dx, BOX.top + MOVE.dy]);

  const arrow = await storedArrow(page);
  const points = arrow.points as Array<{ x: number; y: number }>;
  const startY = (arrow.y as number) + points[0]!.y;
  // The anchor moved with the box; the endpoint must have gone exactly with it. Bound by `focus`
  // alone this drifts tens of pixels — the endpoint slides along the outline as the reference
  // direction changes.
  expect(Math.abs(startY - (LEFT_ANCHOR.y + MOVE.dy))).toBeLessThan(1.5);
});

test("an elbow connector offers no insert-a-bend dot — its route comes from its two endpoints", async ({ page }) => {
  await drawBox(page);
  await page.getByTestId("toolbar-arrow-tool").click();
  await drag(page, [320, CENTRE.y], [CENTRE.x, CENTRE.y]);

  // The arrow is selected on creation, so the properties panel is already offering the type control.
  await page.getByTestId("style-arrowType-elbow").click();
  expect((await storedArrow(page)).arrowType).toBe("elbow");
  await page.getByTestId("toolbar-select-tool").click();

  const middle = { x: 440, y: CENTRE.y }; // mid-segment, outside the box
  await page.mouse.move(middle.x, middle.y);
  await drag(page, [middle.x, middle.y], [middle.x, middle.y + 80]);

  // Two stored points still: the drag found no dot to grab, so it moved the whole arrow instead.
  expect((await storedArrow(page)).points).toHaveLength(2);
});
