import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Elbow connectors bind from anywhere inside a shape; straight and curved arrows only from near its
 * outline. An elbow connector exists to join boxes, so aiming at a box means it — whereas drawing a
 * straight arrow *through* something is ordinary, and attaching on the way past would be wrong.
 */

const AUTOSAVE_FLUSH_MS = 1300;
/** Deliberately large, so its centre is far outside the near-outline band either way. */
const BOX = { left: 560, top: 240, right: 900, bottom: 560 } as const;
const CENTRE = { x: (BOX.left + BOX.right) / 2, y: (BOX.top + BOX.bottom) / 2 } as const;

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

/** Draws the big box, then an arrow from the left ending in its dead centre. */
async function drawBoxAndArrowToCentre(page: Page): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await drag(page, [BOX.left, BOX.top], [BOX.right, BOX.bottom]);

  await page.getByTestId("toolbar-arrow-tool").click();
  await drag(page, [320, CENTRE.y], [CENTRE.x, CENTRE.y]);
}

test("a straight arrow released deep inside a shape does not attach to it", async ({ page }) => {
  await drawBoxAndArrowToCentre(page);

  const arrow = await storedArrow(page);
  expect(arrow.arrowType).toBe("straight");
  expect(arrow.endBinding).toBeNull();
});

test("an elbow connector released in the same spot does attach", async ({ page }) => {
  await drawBoxAndArrowToCentre(page);

  // The arrow is selected on creation, so the properties panel is already offering the type control.
  await page.getByTestId("style-arrowType-elbow").click();
  expect((await storedArrow(page)).arrowType).toBe("elbow");

  // Re-drop the same endpoint in the same place, now as an elbow connector.
  await page.getByTestId("toolbar-select-tool").click();
  await drag(page, [CENTRE.x, CENTRE.y], [CENTRE.x + 4, CENTRE.y + 4]);

  expect((await storedArrow(page)).endBinding).not.toBeNull();
});

test("an elbow connector offers no insert-a-bend dot — its route comes from its two endpoints", async ({ page }) => {
  await drawBoxAndArrowToCentre(page);
  await page.getByTestId("style-arrowType-elbow").click();
  await page.getByTestId("toolbar-select-tool").click();

  const middle = { x: 440, y: CENTRE.y }; // mid-segment, outside the box
  await page.mouse.move(middle.x, middle.y);
  await drag(page, [middle.x, middle.y], [middle.x, middle.y + 80]);

  // Two stored points still: the drag found no dot to grab, so it moved the whole arrow instead.
  expect((await storedArrow(page)).points).toHaveLength(2);
});
