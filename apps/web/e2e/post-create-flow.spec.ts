import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Post-creation interaction model (matching Excalidraw/tldraw): after drawing, control returns to the
 * select tool and the new element is selected — unless the tool lock is engaged. Plus double-click
 * affordances: empty canvas creates text, a shape gets bound text, and a labelled shape stays grabbable
 * from its interior afterwards.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function dragRect(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2);
  await page.mouse.move(x2, y2);
  await page.mouse.up();
}

test("drawing a shape switches back to the select tool and selects the new element", async ({ page }) => {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await dragRect(page, 300, 300, 480, 420);

  await expect(page.getByTestId("toolbar-select-tool")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("toolbar-rectangle-tool")).toHaveAttribute("aria-pressed", "false");
  // The Layer actions render only when a selection exists → the new rectangle is selected.
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();
});

test("drawing a line by dragging also hands back to select and selects the line", async ({ page }) => {
  await page.getByTestId("toolbar-line-tool").click();
  await dragRect(page, 260, 460, 520, 500);
  await expect(page.getByTestId("toolbar-select-tool")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();
});

test("the tool lock keeps the drawing tool active after drawing (no auto-switch)", async ({ page }) => {
  await page.getByTestId("toolbar-lock").click();
  await expect(page.getByTestId("toolbar-lock")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("toolbar-rectangle-tool").click();
  await dragRect(page, 300, 300, 460, 400);

  await expect(page.getByTestId("toolbar-rectangle-tool")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("toolbar-select-tool")).toHaveAttribute("aria-pressed", "false");
});

test("double-clicking empty canvas creates a new text element", async ({ page }) => {
  await page.mouse.dblclick(650, 380);
  const textarea = page.getByTestId("text-editor-overlay-textarea");
  await expect(textarea).toBeVisible();
  await textarea.fill("hello");
  await textarea.press("Escape"); // Escape commits (Enter is a newline now)
  await expect(page.getByTestId("text-editor-overlay-textarea")).not.toBeVisible();
  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
});

test("double-clicking a just-drawn shape inserts bound text (reachable immediately after drawing)", async ({ page }) => {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await dragRect(page, 300, 300, 520, 440);
  // Post-draw we're already in the select tool, so double-clicking the shape body opens bound-text editing.
  await page.mouse.dblclick(410, 370);
  await expect(page.getByTestId("text-editor-overlay-textarea")).toBeVisible();
});

/** The rectangle's top-left corner as persisted, so a drag can be measured in scene units. */
async function persistedRectOrigin(page: Page): Promise<{ x: number; y: number }> {
  await page.waitForTimeout(1300); // autosave debounce
  return page.evaluate(() => {
    const scene = JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!) as {
      elements: Array<{ type: string; x: number; y: number; isDeleted?: boolean }>;
    };
    const rect = scene.elements.find((element) => element.type === "rectangle" && !element.isDeleted)!;
    return { x: rect.x, y: rect.y };
  });
}

test("a labelled shape is grabbed from its empty interior, not only from its hairline stroke", async ({ page }) => {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await dragRect(page, 300, 300, 520, 440); // drawn with a transparent fill, the default
  await page.mouse.dblclick(410, 370);
  const textarea = page.getByTestId("text-editor-overlay-textarea");
  await expect(textarea).toBeVisible();
  await textarea.fill("sss");
  await textarea.press("Escape");
  await expect(textarea).not.toBeVisible();

  // Drop the selection first: with the shape still selected, a drag from inside its frame would move it
  // through the "grab the existing selection" path and prove nothing about hit-testing.
  await page.mouse.click(760, 560);
  await expect(page.locator('[data-testid^="layer-action-"]')).toHaveCount(0);

  const before = await persistedRectOrigin(page);
  // Deep inside the shape — clear of the label in the middle and far from every edge, so only the
  // interior test can produce a hit. Without one this is bare canvas and the drag draws a marquee.
  await page.mouse.move(340, 325);
  await page.mouse.down();
  await page.mouse.move(370, 375);
  await page.mouse.move(400, 425);
  await page.mouse.up();

  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();
  const after = await persistedRectOrigin(page);
  expect(after.x - before.x).toBeCloseTo(60, -1);
  expect(after.y - before.y).toBeCloseTo(100, -1);
});
