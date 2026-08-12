import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Arrow-type selection (including the newly-routed elbow connector) and the context menu's
 * discoverability fixes. `arrowType` was modelled in the engine from the start but had no control at
 * all, so every arrow was stuck on whatever the tool inferred from its vertex count.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function drawArrow(page: Page): Promise<void> {
  await page.getByTestId("toolbar-arrow-tool").click();
  await page.mouse.move(300, 250);
  await page.mouse.down();
  await page.mouse.move(600, 400);
  await page.mouse.up();
}

/** Reads the one arrow in the persisted scene. */
async function storedArrow(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("devivadraw:autosave:v1");
    const scene = JSON.parse(raw!) as { elements: Array<Record<string, unknown>> };
    return scene.elements.find((element) => element.type === "arrow")!;
  });
}

test("the properties panel offers straight / curved / elbow, and the choice persists", async ({ page }) => {
  await drawArrow(page);

  for (const type of ["straight", "curved", "elbow"]) {
    await expect(page.getByTestId(`style-arrowType-${type}`)).toBeVisible();
  }

  await page.getByTestId("style-arrowType-elbow").click();
  await page.waitForTimeout(1300); // let autosave flush
  expect((await storedArrow(page)).arrowType).toBe("elbow");
});

test("an elbow arrow renders as axis-aligned segments, not a diagonal", async ({ page }) => {
  await drawArrow(page);
  await page.getByTestId("style-arrowType-elbow").click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));

  // The arrow runs (300,250) -> (600,400), so the elbow routes
  // (300,250) -> (450,250) -> (450,400) -> (600,400).
  //
  // The probe point must sit on the straight diagonal but *off* every elbow segment. The diagonal's
  // own midpoint (450,325) is no good: it lands exactly on the route's vertical run. (375,287) is on
  // the diagonal (y = 250 + (75/300)*150) and clear of all three segments.
  const { onDiagonal, onElbowCorner } = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="deviva-draw-canvas-host"] canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const inkNear = (x: number, y: number, radius = 6) => {
      const data = ctx.getImageData(Math.round((x - rect.left - radius) * sx), Math.round((y - rect.top - radius) * sy), Math.round(radius * 2 * sx), Math.round(radius * 2 * sy)).data;
      let opaque = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 20) opaque++;
      return opaque;
    };
    return { onDiagonal: inkNear(375, 287), onElbowCorner: inkNear(450, 250) };
  });

  expect(onElbowCorner).toBeGreaterThan(0);
  expect(onDiagonal).toBe(0);
});

test("an elbow arrow is selectable along the path it is actually drawn on", async ({ page }) => {
  await drawArrow(page);
  await page.getByTestId("style-arrowType-elbow").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("toolbar-select-tool").click();
  // Clear the selection first: a click anywhere inside a *selected* element's bounding box grabs the
  // whole selection to move it (`selection-tool.ts`), which would keep the arrow selected regardless of
  // whether the geometry hit test matched — masking exactly what this test is checking.
  await page.keyboard.press("Escape");

  // The arrow-type control only renders for a *selected* arrow, so its presence is the selection probe.
  // (The properties panel itself is always mounted — with nothing selected it edits next-shape defaults.)
  const arrowSelected = page.getByTestId("style-arrowType-elbow");
  await expect(arrowSelected).toHaveCount(0);

  // Clicking the straight diagonal, where an elbow arrow is NOT drawn, must miss (see the render test
  // for why (375,287) and not the diagonal's midpoint).
  await page.mouse.click(375, 287);
  await expect(arrowSelected).toHaveCount(0);

  // ...and clicking the routed horizontal run, where it IS drawn, must select it.
  await page.mouse.click(400, 250);
  await expect(arrowSelected).toBeVisible();
});

test("the context menu shows each action's shortcut", async ({ page }) => {
  await drawArrow(page);
  await page.getByTestId("toolbar-select-tool").click();
  await page.mouse.click(400, 250);
  await page.mouse.click(400, 250, { button: "right" });

  await expect(page.getByTestId("context-menu")).toBeVisible();
  await expect(page.getByTestId("context-menu-duplicate")).toContainText("D");
  await expect(page.getByTestId("context-menu-copy")).toContainText("C");
});

test("ungroup is disabled for an ungrouped selection and enabled once grouped", async ({ page }) => {
  await drawArrow(page);
  await page.getByTestId("toolbar-select-tool").click();
  await page.mouse.click(400, 250);
  await page.mouse.click(400, 250, { button: "right" });

  // A single ungrouped element: Group is correctly unavailable, and so must Ungroup be.
  await expect(page.getByTestId("context-menu-group")).toBeDisabled();
  await expect(page.getByTestId("context-menu-ungroup")).toBeDisabled();
  await page.keyboard.press("Escape");

  // Add a second element, group the pair, and Ungroup becomes available.
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(700, 250);
  await page.mouse.down();
  await page.mouse.move(820, 350);
  await page.mouse.up();
  await page.getByTestId("toolbar-select-tool").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+g");

  await page.mouse.click(760, 300, { button: "right" });
  await expect(page.getByTestId("context-menu-ungroup")).toBeEnabled();
});
