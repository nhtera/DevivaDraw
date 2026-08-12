import { test, expect } from "@playwright/test";

/**
 * Personal element library (Excalidraw parity): save a selection, re-insert it, remove it, and
 * persist across reload.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function openLibrary(page: import("@playwright/test").Page) {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-library").click();
  await expect(page.getByTestId("library-panel")).toBeVisible();
  // The sidebar slides in from the right edge, and `boundingBox()` does not wait for that: measuring
  // straight away reports the panel still translated a full width off-screen.
  await page.getByTestId("library-panel").evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished)));
}

async function drawRect(page: import("@playwright/test").Page) {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(360, 300);
  await page.mouse.down();
  await page.mouse.move(480, 400);
  await page.mouse.up();
}

test("saving a selection adds a library item, and it persists across reload", async ({ page }) => {
  await drawRect(page); // auto-selected
  await openLibrary(page);

  await page.getByTestId("library-add").click();
  await expect(page.getByTestId("library-item")).toHaveCount(1);

  // Reload → the item is restored from localStorage.
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await openLibrary(page);
  await expect(page.getByTestId("library-item")).toHaveCount(1);
});

test("clicking a library item inserts a fresh copy onto the canvas", async ({ page }) => {
  await drawRect(page);
  await openLibrary(page);
  await page.getByTestId("library-add").click();
  await expect(page.getByTestId("library-item")).toHaveCount(1);

  // Deselect by clicking empty canvas so the layer actions disappear; inserting from the library must
  // bring them back with the freshly-inserted copy. The clear space is the lower middle — the
  // properties panel holds the left edge, the library sidebar the right, and the rectangle sits above.
  await page.mouse.click(300, 560);
  await expect(page.locator('[data-testid^="layer-action-"]')).toHaveCount(0);

  await page.getByTestId("library-item").click();
  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();
});

test("removing a library item empties the library", async ({ page }) => {
  await drawRect(page);
  await openLibrary(page);
  await page.getByTestId("library-add").click();
  await expect(page.getByTestId("library-item")).toHaveCount(1);

  // The remove control is revealed on tile hover, so the previews stay readable at four columns.
  await page.getByTestId("library-item").hover();
  await page.getByTestId("library-item-remove").click();
  await expect(page.getByTestId("library-item")).toHaveCount(0);
});

test("the sidebar holds the right edge and pushes the properties panel and minimap clear of itself", async ({ page }) => {
  await drawRect(page); // gives the properties panel and minimap something to show
  const propertiesRight = async () => (await page.getByTestId("properties-panel").boundingBox())!.x + (await page.getByTestId("properties-panel").boundingBox())!.width;
  const before = await propertiesRight();

  await openLibrary(page);
  const sidebar = (await page.getByTestId("library-panel").boundingBox())!;
  const viewport = page.viewportSize()!;

  // Full height, flush to the right edge.
  expect(sidebar.y).toBeLessThanOrEqual(1);
  expect(Math.round(sidebar.height)).toBe(viewport.height);
  expect(Math.round(sidebar.x + sidebar.width)).toBe(viewport.width);

  // ...and the right-anchored chrome moved out from under it instead of being covered.
  expect(await propertiesRight()).toBeLessThanOrEqual(sidebar.x);
  const minimap = (await page.getByTestId("minimap").boundingBox())!;
  expect(minimap.x + minimap.width).toBeLessThanOrEqual(sidebar.x);

  // Closing hands the space straight back.
  await page.getByTestId("library-close").click();
  await expect(page.getByTestId("library-panel")).toHaveCount(0);
  expect(await propertiesRight()).toBeCloseTo(before, 0);
});

test("search filters the library by item name", async ({ page }) => {
  await drawRect(page);
  await openLibrary(page);
  await page.getByTestId("library-add").click();
  await expect(page.getByTestId("library-item")).toHaveCount(1);

  await page.getByTestId("library-search").fill("nothing matches this");
  await expect(page.getByTestId("library-item")).toHaveCount(0);
  await expect(page.getByTestId("library-no-results")).toBeVisible();

  await page.getByTestId("library-search").fill("Item");
  await expect(page.getByTestId("library-item")).toHaveCount(1);
});

test("the library has a permanent button of its own, which both opens and closes it", async ({ page }) => {
  const toggle = page.getByTestId("library-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await toggle.click();
  await expect(page.getByTestId("library-panel")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // The same button closes it: the sidebar covers the right edge, so the toggle has to step aside far
  // enough to stay clickable rather than being buried under what it opened.
  await toggle.click();
  await expect(page.getByTestId("library-panel")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test("the library button stays clear of the sidebar it opens", async ({ page }) => {
  const toggle = page.getByTestId("library-toggle");
  await toggle.click();
  const sidebar = page.getByTestId("library-panel");
  await expect(sidebar).toBeVisible();

  const toggleBox = (await toggle.boundingBox())!;
  const sidebarBox = (await sidebar.boundingBox())!;
  expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(sidebarBox.x);
});

test("dragging a tile onto the canvas drops it at the cursor, not at the viewport centre", async ({ page }) => {
  await drawRect(page);
  await openLibrary(page);
  await page.getByTestId("library-add").click();
  await expect(page.getByTestId("library-item")).toHaveCount(1);

  // Drop far from the centre, and far from the source rectangle, so "landed at the cursor" and
  // "landed in the middle" cannot be confused for one another.
  const target = { x: 260, y: 560 };
  await page.getByTestId("library-item").dragTo(page.getByTestId("deviva-draw-canvas-host"), { targetPosition: target });

  const dropped = await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1300)); // autosave debounce
    const scene = JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!) as {
      elements: Array<{ x: number; y: number; width: number; height: number; isDeleted?: boolean }>;
    };
    const live = scene.elements.filter((element) => !element.isDeleted);
    const newest = live[live.length - 1]!;
    return { count: live.length, centerX: newest.x + newest.width / 2, centerY: newest.y + newest.height / 2 };
  });

  expect(dropped.count).toBe(2); // the original plus the dropped copy
  // Camera is at the origin and unzoomed, so scene coordinates are screen coordinates here.
  expect(dropped.centerX).toBeCloseTo(target.x, -1);
  expect(dropped.centerY).toBeCloseTo(target.y, -1);
});

test("the tile grid keeps its four columns and never scrolls sideways", async ({ page }) => {
  // The sidebar is sized to fit exactly four tiles. That sum has to include its own 1px border — the
  // panel is `border-box`, so omitting it silently costs the grid a whole column.
  await openLibrary(page);

  const grid = await page.getByTestId("library-add").evaluate((node) => {
    const container = node.parentElement!;
    return {
      columns: getComputedStyle(container).gridTemplateColumns.split(" ").length,
      overflowsX: container.scrollWidth > container.clientWidth + 1,
    };
  });
  expect(grid.columns).toBe(4);
  expect(grid.overflowsX).toBe(false);
});
