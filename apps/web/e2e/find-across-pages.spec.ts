import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Find is document-wide. Multi-page documents shipped in 0.10 while find stayed scene-scoped, so
 * Cmd+F searched whichever page happened to be on screen and reported "no matches" for text one page
 * away — the defect these tests exist to hold shut.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function typeTextAt(page: Page, x: number, y: number, text: string): Promise<void> {
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(x, y);
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
}

/** Page 1 holds "alpha here"; a second page holds "needle on two". Ends on page 2. */
async function twoPageDocument(page: Page): Promise<void> {
  await typeTextAt(page, 400, 300, "alpha here");
  await page.getByTestId("pages-toggle").click();
  await page.getByTestId("page-add").click();
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 2");
  await typeTextAt(page, 400, 300, "needle on two");
}

test("a match on another page is found, labelled with its page, and switched to", async ({ page }) => {
  await twoPageDocument(page);

  // Back to page 1, so the match is on a page that is not on screen.
  await page.getByTestId("pages-toggle").click();
  await page.locator('[data-testid^="page-item-"]').first().click();
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 1");

  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.getByTestId("find-panel")).toBeVisible();
  await page.getByTestId("find-input").fill("needle");

  await expect(page.getByTestId("find-count")).toHaveText("1 / 1");
  await expect(page.getByTestId("find-page")).toContainText("Page 2");
  // Revealing it switched the document to the page it is on.
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 2");
});

test("a query matching both pages counts both, in page order", async ({ page }) => {
  await typeTextAt(page, 400, 300, "shared word");
  await page.getByTestId("pages-toggle").click();
  await page.getByTestId("page-add").click();
  await typeTextAt(page, 400, 300, "shared again");

  await page.keyboard.press("ControlOrMeta+f");
  await page.getByTestId("find-input").fill("shared");

  await expect(page.getByTestId("find-count")).toHaveText("1 / 2");
  await expect(page.getByTestId("find-page")).toContainText("Page 1"); // the first match is page 1's
  await page.getByTestId("find-next").click();
  await expect(page.getByTestId("find-page")).toContainText("Page 2");
});

test("Escape without picking a match returns to the page the search started on", async ({ page }) => {
  await twoPageDocument(page);
  await page.getByTestId("pages-toggle").click();
  await page.locator('[data-testid^="page-item-"]').first().click();
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 1");

  await page.keyboard.press("ControlOrMeta+f");
  await page.getByTestId("find-input").fill("needle");
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 2"); // auto-revealed
  await page.getByTestId("find-input").press("Escape");

  await expect(page.getByTestId("find-panel")).toBeHidden();
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 1");
});

test("picking a match and closing keeps that match's page", async ({ page }) => {
  await twoPageDocument(page);
  await page.getByTestId("pages-toggle").click();
  await page.locator('[data-testid^="page-item-"]').first().click();

  await page.keyboard.press("ControlOrMeta+f");
  await page.getByTestId("find-input").fill("needle");
  await page.getByTestId("find-next").click(); // an explicit step accepts the match
  await page.getByTestId("find-close").click();

  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 2");
});

test("a single-page document searches exactly as it did before", async ({ page }) => {
  await typeTextAt(page, 400, 300, "only page");

  await page.keyboard.press("ControlOrMeta+f");
  await page.getByTestId("find-input").fill("only");

  await expect(page.getByTestId("find-count")).toHaveText("1 / 1");
  // Nothing to disambiguate on a one-page document, so no page label is shown.
  await expect(page.getByTestId("find-page")).toContainText("Page 1");
});

test("a find-driven page switch mid-drag abandons the drag cleanly, instead of half-applying it", async ({ page }) => {
  // A page switch tears the runtime down. The move gesture opens a history batch on pointerdown that
  // only a later finish/cancel closes — so without cancelling the gesture on teardown, the partial
  // translation stays applied to the scene while the batch that would have recorded it is thrown
  // away with the runtime. The shape ends up moved with nothing to undo it back.
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(520, 400);
  await page.mouse.up();
  await page.keyboard.press("Escape");

  await page.getByTestId("pages-toggle").click();
  await page.getByTestId("page-add").click();
  await typeTextAt(page, 400, 300, "needle on two");
  await page.getByTestId("pages-toggle").click();
  await page.locator('[data-testid^="page-item-"]').first().click();
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 1");

  // Start moving the rectangle, and let a find-driven page switch land before pointerup.
  await page.getByTestId("toolbar-select-tool").click();
  await page.mouse.click(400, 300);
  await page.mouse.move(460, 350);
  await page.mouse.down();
  await page.mouse.move(500, 380);
  await page.keyboard.press("ControlOrMeta+f");
  await page.getByTestId("find-input").fill("needle");
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 2");
  await page.mouse.up();
  await page.getByTestId("find-input").press("Escape");
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 1");

  await page.waitForTimeout(1300);
  const rectangle = await page.evaluate(() => {
    const scene = ((autosaved: unknown) => { const doc = autosaved as { pages?: Array<{ id: string; scene: unknown }>; activePageId?: string }; return doc.pages ? (doc.pages.find((entry) => entry.id === doc.activePageId) ?? doc.pages[0]!).scene : autosaved; })(JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!)) as { elements: Array<{ type: string; isDeleted?: boolean; x: number }> };
    return scene.elements.find((element) => element.type === "rectangle" && !element.isDeleted)!;
  });
  // Back where it started: the abandoned drag was cancelled, not committed halfway.
  expect(rectangle.x).toBeCloseTo(400, 0);
});
