import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Dragging a group that contains a shape *and* an arrow bound to it must translate it as a rigid
 * body. The regression: each element write ran the binding hook synchronously, so writing the shape
 * first (z-order puts connectors on top) rerouted the still-unmoved arrow's bound endpoint onto the
 * shape's new position; translating the arrow afterwards then moved that already-rewritten geometry
 * again. The bound end travelled the drag delta twice and the free end once, so the arrow stretched
 * by the drag distance and the selection box visibly changed size mid-drag.
 *
 * Asserted through the real app with trusted mouse input: the arrow's own length, and the width of
 * the box the whole selection occupies, both survive the drag unchanged.
 */

const RECT = { left: 300, top: 300, right: 450, bottom: 420 } as const;
const ARROW_TAIL = { x: 620, y: 360 } as const;
const ARROW_HEAD = { x: RECT.right + 10, y: 360 } as const; // dropped just off the rect's right edge → binds
const AUTOSAVE_FLUSH_MS = 1300;

interface StoredElement {
  type: string;
  isDeleted: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  points?: Array<{ x: number; y: number }>;
  endBinding?: unknown;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function drag(page: Page, from: readonly [number, number], to: readonly [number, number]): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  // Several intermediate moves: the bug compounds per pointermove, so a one-step drag would understate it.
  for (let step = 1; step <= 4; step += 1) {
    await page.mouse.move(from[0] + ((to[0] - from[0]) * step) / 4, from[1] + ((to[1] - from[1]) * step) / 4);
  }
  await page.mouse.up();
}

/** The live (not yet autosaved) elements, read back after letting autosave flush. */
async function storedElements(page: Page): Promise<StoredElement[]> {
  await page.waitForTimeout(AUTOSAVE_FLUSH_MS);
  return page.evaluate(() => {
    const raw = localStorage.getItem("devivadraw:autosave:v1");
    if (!raw) return [];
    const autosaved = JSON.parse(raw) as { pages?: Array<{ id: string; scene: { elements: unknown[] } }>; activePageId?: string; elements?: unknown[] };
    const scene = autosaved.pages ? (autosaved.pages.find((entry) => entry.id === autosaved.activePageId) ?? autosaved.pages[0]!).scene : (autosaved as unknown as { elements: unknown[] });
    return (scene.elements as StoredElement[]).filter((element) => !element.isDeleted);
  });
}

function arrowLength(elements: StoredElement[]): number {
  const arrow = elements.find((element) => element.type === "arrow");
  if (!arrow?.points) throw new Error("no arrow in the scene");
  const first = arrow.points[0]!;
  const last = arrow.points[arrow.points.length - 1]!;
  return Math.hypot(last.x - first.x, last.y - first.y);
}

/** Width of the axis-aligned box the whole scene occupies — the same span the selection outline draws around a group. */
function sceneWidth(elements: StoredElement[]): number {
  const left = Math.min(...elements.map((element) => element.x));
  const right = Math.max(...elements.map((element) => element.x + element.width));
  return right - left;
}

test("dragging a grouped shape + bound arrow keeps the group's size", async ({ page }) => {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await drag(page, [RECT.left, RECT.top], [RECT.right, RECT.bottom]);

  await page.getByTestId("toolbar-arrow-tool").click();
  await drag(page, [ARROW_TAIL.x, ARROW_TAIL.y], [ARROW_HEAD.x, ARROW_HEAD.y]);

  await page.getByTestId("toolbar-select-tool").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+g");

  const before = await storedElements(page);
  expect(before.find((element) => element.type === "arrow")?.endBinding).toBeTruthy(); // the arrow really is bound to the rect
  await page.screenshot({ path: "test-results/group-move-before.png" });

  // Grab the group by the rectangle's top edge (a transparent interior is not a hit target) and drag.
  await drag(page, [(RECT.left + RECT.right) / 2, RECT.top], [(RECT.left + RECT.right) / 2 + 130, RECT.top + 90]);

  const after = await storedElements(page);
  await page.screenshot({ path: "test-results/group-move-after.png" });

  expect(arrowLength(after)).toBeCloseTo(arrowLength(before), 1);
  expect(sceneWidth(after)).toBeCloseTo(sceneWidth(before), 1);
  const rectBefore = before.find((element) => element.type === "rectangle")!;
  const rectAfter = after.find((element) => element.type === "rectangle")!;
  expect(rectAfter.x - rectBefore.x).toBeCloseTo(130, 0);
  expect(rectAfter.y - rectBefore.y).toBeCloseTo(90, 0);
});
