import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Editor-behavior preferences (main menu → Preferences): "Select on" (Auto / Wrap / Overlap),
 * "Arrow binding", "Snap to midpoints" — plus the double-click-a-tip arrowhead toggle.
 *
 * The two marquee cases are written as inversions of the default: each drags in the direction that
 * would produce the OPPOSITE result under "Auto", so a preference that silently failed to apply
 * would fail the test rather than coincidentally agreeing with the default.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function openPreferencesFlyout(page: Page): Promise<void> {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-preferences").click();
  await expect(page.getByTestId("main-menu-preferences-flyout")).toBeVisible();
}

async function closeMenu(page: Page): Promise<void> {
  await page.keyboard.press("Escape"); // flyout
  await page.keyboard.press("Escape"); // menu
  await expect(page.getByTestId("main-menu")).toHaveCount(0);
}

/**
 * Draws a rectangle spanning (600,250)-(800,400) and leaves nothing selected.
 *
 * Everything in this spec stays right of x=560: the properties panel occupies the canvas's left edge
 * whenever a creation tool is active, so a gesture started further left lands on chrome and never
 * reaches the canvas at all.
 */
async function drawRectangleAndDeselect(page: Page): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(600, 250);
  await page.mouse.down();
  await page.mouse.move(800, 400, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await expect(selectedMarkers(page)).toHaveCount(0);
}

/** The layer-action rows render only for a non-empty selection — the spec's "is anything selected" probe. */
function selectedMarkers(page: Page) {
  return page.locator('[data-testid^="layer-action-"]');
}

async function marqueeDrag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.getByTestId("toolbar-select-tool").click();
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 10 });
  await page.mouse.up();
}

interface StoredArrow {
  x: number;
  y: number;
  points: { x: number; y: number }[];
  startArrowhead: string;
  endArrowhead: string;
  startBinding: unknown;
  endBinding: unknown;
}

/** The autosaved element of `type` (waits out the autosave debounce, as `table.spec.ts` does). */
async function storedElement(page: Page, type: string): Promise<StoredArrow> {
  await page.waitForTimeout(1300);
  const element = await page.evaluate((wanted) => {
    const doc = JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!);
    const scene = doc.pages ? doc.pages[0].scene : doc;
    return scene.elements.find((el: { type: string; isDeleted: boolean }) => el.type === wanted && !el.isDeleted) ?? null;
  }, type);
  expect(element, `expected a ${type} in the autosaved document`).not.toBeNull();
  return element as StoredArrow;
}

const storedArrow = (page: Page) => storedElement(page, "arrow");

/**
 * Selects the rectangle by its stroke and drags it far downward, asserting it really moved.
 *
 * The assertion matters more than it looks: an unselected shape does not move when dragged from
 * inside its (unfilled) bounds — it starts a marquee instead. Without this check the binding-OFF
 * test below would pass for the wrong reason, since "the arrow did not move" is also true when
 * nothing moved at all.
 */
async function moveRectangleDown(page: Page): Promise<void> {
  await page.getByTestId("toolbar-select-tool").click();
  await page.mouse.click(700, 250); // on the rectangle's top edge — its stroke, not its hollow interior
  await expect(selectedMarkers(page).first()).toBeVisible();

  const before = await storedElement(page, "rectangle");
  await page.mouse.move(770, 380); // inside the now-selected bounds, clear of the arrow's endpoint
  await page.mouse.down();
  await page.mouse.move(770, 620, { steps: 10 });
  await page.mouse.up();

  const after = await storedElement(page, "rectangle");
  expect(after.y, "the rectangle itself must have moved for this test to mean anything").toBeGreaterThan(before.y + 100);
}

test('"Wrap" makes a left-to-right drag select only what it fully encloses', async ({ page }) => {
  await drawRectangleAndDeselect(page);

  // Baseline: under the default "Auto", this same left-to-right partial-overlap drag selects it.
  await marqueeDrag(page, [520, 200], [700, 320]);
  await expect(selectedMarkers(page).first()).toBeVisible();
  await page.keyboard.press("Escape");

  await openPreferencesFlyout(page);
  await page.getByTestId("main-menu-select-on-wrap").click();
  await expect(page.getByTestId("main-menu-select-on-wrap")).toHaveAttribute("aria-checked", "true");
  await closeMenu(page);

  await marqueeDrag(page, [520, 200], [700, 320]);
  await expect(selectedMarkers(page)).toHaveCount(0); // partial overlap no longer counts
});

test('"Overlap" makes a right-to-left drag select anything it touches', async ({ page }) => {
  await drawRectangleAndDeselect(page);

  // Baseline: under the default "Auto", a right-to-left partial-overlap drag selects nothing.
  await marqueeDrag(page, [1000, 200], [700, 320]);
  await expect(selectedMarkers(page)).toHaveCount(0);

  await openPreferencesFlyout(page);
  await page.getByTestId("main-menu-select-on-overlap").click();
  await closeMenu(page);

  await marqueeDrag(page, [1000, 200], [700, 320]);
  await expect(selectedMarkers(page).first()).toBeVisible(); // touching now counts
});

test("arrow binding off: an arrow drawn into a shape does not follow it when the shape moves", async ({ page }) => {
  await openPreferencesFlyout(page);
  await page.getByTestId("main-menu-arrow-binding").click();
  await expect(page.getByTestId("main-menu-arrow-binding")).toHaveAttribute("aria-checked", "false");
  await closeMenu(page);

  await drawRectangleAndDeselect(page);

  // Arrow drawn from empty canvas into the middle of the rectangle.
  await page.getByTestId("toolbar-arrow-tool").click();
  await page.mouse.move(400, 325);
  await page.mouse.down();
  await page.mouse.move(700, 325, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press("Escape");

  const before = await storedArrow(page);
  expect(before.startBinding ?? null).toBeNull();
  expect(before.endBinding ?? null).toBeNull();

  // Drag the rectangle well away; an unbound arrow must not move with it.
  await moveRectangleDown(page);

  const after = await storedArrow(page);
  expect(after.x).toBeCloseTo(before.x, 3);
  expect(after.y).toBeCloseTo(before.y, 3);
  expect(after.points).toEqual(before.points);
});

test("arrow binding on (the default): the same arrow DOES follow the shape", async ({ page }) => {
  await drawRectangleAndDeselect(page);

  await page.getByTestId("toolbar-arrow-tool").click();
  await page.mouse.move(400, 325);
  await page.mouse.down();
  await page.mouse.move(700, 325, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press("Escape");

  const before = await storedArrow(page);
  expect(before.endBinding).not.toBeNull();

  await moveRectangleDown(page);

  const after = await storedArrow(page);
  expect(after.points).not.toEqual(before.points); // the bound end tracked the shape
});

test("double-clicking an arrow tip toggles that end's arrowhead; the body still opens the label", async ({ page }) => {
  await page.getByTestId("toolbar-arrow-tool").click();
  await page.mouse.move(400, 450);
  await page.mouse.down();
  await page.mouse.move(800, 450, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press("Escape");

  expect((await storedArrow(page)).endArrowhead).toBe("arrow");

  await page.getByTestId("toolbar-select-tool").click();
  await page.mouse.dblclick(800, 450); // the end tip
  await expect.poll(async () => (await storedArrow(page)).endArrowhead).toBe("none");
  await expect(page.getByTestId("text-editor-overlay-textarea")).toHaveCount(0); // no label editor

  await page.mouse.dblclick(800, 450); // toggles back
  await expect.poll(async () => (await storedArrow(page)).endArrowhead).toBe("arrow");

  // The start tip is independent and starts headless.
  await page.mouse.dblclick(400, 450);
  await expect.poll(async () => (await storedArrow(page)).startArrowhead).toBe("arrow");

  // The body still opens the arrow's label editor.
  await page.mouse.dblclick(600, 450);
  await expect(page.getByTestId("text-editor-overlay-textarea")).toBeVisible();
});

test("the arrowhead toggle is a single undo step", async ({ page }) => {
  await page.getByTestId("toolbar-arrow-tool").click();
  await page.mouse.move(400, 450);
  await page.mouse.down();
  await page.mouse.move(800, 450, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press("Escape");

  await page.getByTestId("toolbar-select-tool").click();
  await page.mouse.dblclick(800, 450);
  await expect.poll(async () => (await storedArrow(page)).endArrowhead).toBe("none");

  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(async () => (await storedArrow(page)).endArrowhead).toBe("arrow");
});

test("all three preferences persist across a reload", async ({ page }) => {
  await openPreferencesFlyout(page);
  await page.getByTestId("main-menu-select-on-wrap").click();
  await page.getByTestId("main-menu-arrow-binding").click();
  await page.getByTestId("main-menu-snap-midpoints").click();
  await closeMenu(page);

  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  await openPreferencesFlyout(page);
  await expect(page.getByTestId("main-menu-select-on-wrap")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("main-menu-arrow-binding")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("main-menu-snap-midpoints")).toHaveAttribute("aria-checked", "false");
});
