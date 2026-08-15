import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Editing conveniences every mainstream whiteboard has: Cut, double-click into a group, font-size
 * step shortcuts, and clickable link badges on elements carrying a hyperlink.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function drawRect(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2);
  await page.mouse.up();
}

async function liveElements(page: Page): Promise<Array<{ id: string; type: string; fontSize?: number; groupIds: string[] }>> {
  await page.waitForTimeout(1300);
  return page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!) as { pages: Array<{ scene: { elements: Array<{ isDeleted?: boolean }> } }> };
    return (doc.pages[0]!.scene.elements as Array<{ id: string; type: string; fontSize?: number; groupIds: string[]; isDeleted?: boolean }>).filter((element) => !element.isDeleted);
  });
}

test("Cmd+X cuts the selection and Cmd+V pastes it back", async ({ page }) => {
  await drawRect(page, 300, 300, 400, 380); // auto-selected
  await page.keyboard.press("Meta+x");
  expect(await liveElements(page)).toHaveLength(0);

  await page.keyboard.press("Meta+v");
  expect(await liveElements(page)).toHaveLength(1);
});

test("double-click drills into a group to select one member; a second one opens its label", async ({ page }) => {
  await drawRect(page, 300, 300, 380, 360);
  await drawRect(page, 500, 300, 580, 360);
  await page.getByTestId("toolbar-select-tool").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+g");

  // A single click selects the whole group (both members shown in the layer actions), so drilling
  // needs the double-click: afterwards exactly one element is selected — moving it moves it alone.
  await page.mouse.dblclick(300, 330); // the first rectangle's stroke
  const before = await liveElements(page);
  await page.mouse.move(340, 330);
  await page.mouse.down();
  await page.mouse.move(340, 430);
  await page.mouse.up();
  const after = await liveElements(page);
  const movedCount = after.filter((element, index) => JSON.stringify(element) !== JSON.stringify(before[index])).length;
  expect(movedCount).toBe(1);

  // A second double-click on the now-sole-selected member falls through to label editing.
  await page.mouse.dblclick(340, 430 - 70);
  await expect(page.locator("textarea")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("Cmd+Shift+> and < step a text's font size through the panel's presets", async ({ page }) => {
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(500, 400);
  await page.keyboard.type("resize me");
  await page.keyboard.press("Escape"); // commit — placed text is NOT auto-selected, so select it
  await page.keyboard.press("Meta+a");

  expect((await liveElements(page))[0]!.fontSize).toBe(20); // M
  await page.keyboard.press("Meta+Shift+>");
  expect((await liveElements(page))[0]!.fontSize).toBe(28); // L
  await page.keyboard.press("Meta+Shift+<");
  await page.keyboard.press("Meta+Shift+<");
  expect((await liveElements(page))[0]!.fontSize).toBe(16); // S — and clamped at the bottom
});

test("an element with a hyperlink shows a clickable badge on the canvas", async ({ page }) => {
  await drawRect(page, 300, 300, 400, 380); // auto-selected
  await page.getByTestId("link-button").click();
  await page.getByTestId("link-input").fill("https://deviva.app");
  await page.getByTestId("link-save").click();

  const badge = page.locator('[data-testid^="link-badge-"]');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("href", "https://deviva.app/"); // normalized on save
  await expect(badge).toHaveAttribute("target", "_blank");

  // The badge tracks the element: pan the canvas and it moves with the shape's corner.
  const before = (await badge.boundingBox())!;
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await badge.boundingBox())!.y).not.toBe(before.y);
});
