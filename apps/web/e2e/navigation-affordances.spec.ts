import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Canvas-navigation affordances: the ways out of "I panned and lost my drawing", which the app had the
 * capability for (`zoomToFit`) but no discoverable UI for — only `Shift+1` and a hover tooltip on the
 * zoom readout. Plus the selection frame's padding, which keeps the outline off the element's stroke.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function drawRectangle(page: Page): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(600, 420);
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

/** Pans the canvas far enough that nothing can still be on screen, without touching any chrome. */
async function panFarAway(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="deviva-draw-canvas-host"] canvas')!;
    for (let i = 0; i < 12; i += 1) {
      canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 600, clientX: 700, clientY: 400, bubbles: true, cancelable: true }));
    }
  });
}

test("the back-to-content pill appears only once the drawing is off screen, and brings it back", async ({ page }) => {
  await drawRectangle(page);
  await expect(page.getByTestId("back-to-content")).toHaveCount(0);

  await panFarAway(page);
  await expect(page.getByTestId("back-to-content")).toBeVisible();

  await page.getByTestId("back-to-content").click();
  await expect(page.getByTestId("back-to-content")).toHaveCount(0);
});

test("the back-to-content pill never shows on an empty canvas", async ({ page }) => {
  await panFarAway(page);
  await expect(page.getByTestId("back-to-content")).toHaveCount(0);
});

test("the zoom readout opens a menu of every zoom action instead of firing one hidden one", async ({ page }) => {
  await page.getByTestId("top-bar-zoom-percentage").click();
  await expect(page.getByTestId("zoom-menu-popover")).toBeVisible();

  for (const id of ["zoom-in", "zoom-out", "zoom-to-fit", "zoom-to-selection", "zoom-reset"]) {
    await expect(page.getByTestId(`zoom-menu-${id}`)).toBeVisible();
  }
  // Nothing selected → zoom-to-selection is offered but disabled, rather than silently doing nothing.
  await expect(page.getByTestId("zoom-menu-zoom-to-selection")).toBeDisabled();
});

test("zoom reset returns to 100% from any magnification", async ({ page }) => {
  await drawRectangle(page);
  await page.getByTestId("top-bar-zoom-in").click();
  await page.getByTestId("top-bar-zoom-in").click();
  await expect(page.getByTestId("top-bar-zoom-percentage")).not.toHaveText("100%");

  await page.getByTestId("top-bar-zoom-percentage").click();
  await page.getByTestId("zoom-menu-zoom-reset").click();
  await expect(page.getByTestId("top-bar-zoom-percentage")).toHaveText("100%");
});

test("zoom to selection is enabled with a selection and frames it", async ({ page }) => {
  await drawRectangle(page);
  await page.getByTestId("toolbar-select-tool").click();
  await page.keyboard.press("Meta+a");

  await page.getByTestId("top-bar-zoom-percentage").click();
  await expect(page.getByTestId("zoom-menu-zoom-to-selection")).toBeEnabled();
  await page.getByTestId("zoom-menu-zoom-to-selection").click();
  await expect(page.getByTestId("zoom-menu-popover")).toHaveCount(0);
  await expect(page.getByTestId("top-bar-zoom-percentage")).not.toHaveText("100%");
});

test("every top-bar control carries both a tooltip and an accessible name", async ({ page }) => {
  for (const id of ["top-bar-menu", "top-bar-undo", "top-bar-redo", "top-bar-zoom-out", "top-bar-zoom-in", "top-bar-zoom-percentage"]) {
    const control = page.getByTestId(id);
    await expect(control).toHaveAttribute("title", /.+/);
    await expect(control).toHaveAttribute("aria-label", /.+/);
  }
});

test("the minimap can be hidden from the main menu and the panel reclaims its space", async ({ page }) => {
  await drawRectangle(page);
  await expect(page.getByTestId("minimap")).toBeVisible();

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-preferences").click();
  await page.getByTestId("main-menu-toggle-minimap").click();
  await expect(page.getByTestId("minimap")).toHaveCount(0);

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-preferences").click();
  await page.getByTestId("main-menu-toggle-minimap").click();
  await expect(page.getByTestId("minimap")).toBeVisible();
});

test("the selection outline is inset from the element so its own stroke stays visible", async ({ page }) => {
  await drawRectangle(page);
  await page.getByTestId("toolbar-select-tool").click();
  // Click the rectangle's *stroke*, not its interior: it has a transparent background, and an unfilled
  // shape is deliberately grabbed by its stroke only (engine `hit-test.ts`), matching Excalidraw/tldraw.
  await page.mouse.click(400, 360);

  // Measure where each layer actually paints, rather than probing a band wide enough to catch both:
  // scan one horizontal row rightwards for the last opaque pixel on the static layer (the element's own
  // stroke) and on the interactive layer (the selection outline), then assert the *gap* between them.
  //
  // The row matters. The rectangle spans y 300–420, so its corner handles sit at y=300/420 and its `e`
  // edge handle at y=360 — and an 8px handle square straddles the edge by 4px even with zero padding,
  // which would show a "gap" that has nothing to do with the padding. y=330 is clear of all three, so
  // the only interactive-layer ink there is the outline itself.
  const { strokeRightEdge, selectionRightEdge } = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('[data-testid="deviva-draw-canvas-host"] canvas')) as HTMLCanvasElement[];
    const lastOpaqueX = (cv: HTMLCanvasElement, rowY: number) => {
      const ctx = cv.getContext("2d")!;
      const rect = cv.getBoundingClientRect();
      const sx = cv.width / rect.width;
      const sy = cv.height / rect.height;
      const y = Math.round((rowY - rect.top) * sy);
      const data = ctx.getImageData(0, y, cv.width, 1).data;
      let last = -1;
      for (let x = 0; x < cv.width; x += 1) if (data[x * 4 + 3]! > 20) last = x;
      return last < 0 ? -1 : last / sx + rect.left; // back to CSS px
    };
    // canvases[0] = static (elements), canvases[1] = interactive (selection chrome).
    return { strokeRightEdge: lastOpaqueX(canvases[0]!, 330), selectionRightEdge: lastOpaqueX(canvases[1]!, 330) };
  });

  expect(strokeRightEdge).toBeGreaterThan(0);
  expect(selectionRightEdge).toBeGreaterThan(0);
  // The outline (plus its handle) sits clearly outside the stroke — never on top of it.
  expect(selectionRightEdge - strokeRightEdge).toBeGreaterThan(3);
});
