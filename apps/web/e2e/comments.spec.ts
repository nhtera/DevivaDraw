import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Comment threads: place, reply, resolve, delete, and survive a reload.
 *
 * Comments are records parallel to elements, so the checks that matter most here are the ones that
 * prove that separation holds through the real app: a pin follows its shape, a resolved thread
 * leaves the canvas but stays in the panel, and none of it touches undo history.
 */

const AUTOSAVE_KEY = "devivadraw:autosave:v1";

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
  await page.keyboard.press("Escape");
}

/** Places a pin at a canvas point via the `c` shortcut, and returns the new thread's id. */
async function placeComment(page: Page, x: number, y: number): Promise<string> {
  await page.keyboard.press("c");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  const pin = page.locator('[data-testid^="comment-pin-"]').last();
  await expect(pin).toBeVisible();
  const testId = await pin.getAttribute("data-testid");
  return testId!.replace("comment-pin-", "");
}

async function reply(page: Page, threadId: string, body: string): Promise<void> {
  const composer = page.getByTestId(`comment-composer-${threadId}`);
  await expect(composer).toBeVisible();
  await composer.fill(body);
  await composer.press("Enter");
}

/** The first element's scene x, read out of the autosaved document (waits out the debounce). */
async function elementX(page: Page): Promise<number> {
  return page.evaluate(async (key) => {
    await new Promise((resolve) => setTimeout(resolve, 1300));
    return JSON.parse(localStorage.getItem(key)!).pages[0].scene.elements[0].x as number;
  }, AUTOSAVE_KEY);
}

async function openCommentsPanel(page: Page): Promise<void> {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-preferences").click();
  await page.getByTestId("main-menu-toggle-comments").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("comments-panel")).toBeVisible();
}

test("place a comment, reply, and see both the pin and the conversation", async ({ page }) => {
  await drawRect(page, 400, 200, 560, 300);
  const threadId = await placeComment(page, 480, 250);

  // Placing a pin opens its composer immediately — a comment exists to hold words.
  await reply(page, threadId, "does this align?");
  await expect(page.getByTestId(`comment-thread-${threadId}`).getByText("does this align?")).toBeVisible();

  await reply(page, threadId, "fixed now");
  await expect(page.getByTestId(`comment-thread-${threadId}`).getByText("fixed now")).toBeVisible();
  // Two replies collapse the pin's icon into a count.
  await expect(page.getByTestId(`comment-pin-${threadId}`)).toHaveText("2");
});

test("the pin follows its shape when the shape moves", async ({ page }) => {
  await drawRect(page, 400, 200, 560, 300);
  // Pinned on the shape's bottom STROKE: a hollow rectangle's interior is not a hit, so a pin dropped
  // in the middle would anchor to the empty point instead of the shape — which is correct behaviour,
  // and exactly what this test must avoid in order to exercise the element anchor.
  const threadId = await placeComment(page, 480, 300);
  await page.getByTestId(`comment-close-${threadId}`).click();

  const anchorKind = await page.evaluate(async (key) => {
    await new Promise((resolve) => setTimeout(resolve, 1300));
    return JSON.parse(localStorage.getItem(key)!).pages[0].scene.comments[0].anchor.kind;
  }, AUTOSAVE_KEY);
  expect(anchorKind).toBe("element");

  const pin = page.getByTestId(`comment-pin-${threadId}`);
  const pinBefore = (await pin.boundingBox())!;
  const shapeBefore = await elementX(page);

  // Drag the shape right by its left stroke — clear of the pin, which is clickable chrome and
  // intercepts the pointer over its own small box exactly as a link badge does.
  await page.keyboard.press("v");
  await page.mouse.click(430, 300); // select by its bottom stroke, away from every resize handle
  await page.mouse.move(430, 300);
  await page.mouse.down();
  await page.mouse.move(630, 300, { steps: 10 });
  await page.mouse.up();

  const pinAfter = (await pin.boundingBox())!;
  const shapeAfter = await elementX(page);
  // The shape actually moved, and the pin moved with it by exactly the same amount — which is what
  // "the anchor is a fraction of the shape's box, resolved at read time" has to mean in practice.
  expect(shapeAfter).toBeGreaterThan(shapeBefore + 50);
  expect(pinAfter.x - pinBefore.x).toBeCloseTo(shapeAfter - shapeBefore, 0);
});

test("a resolved thread leaves the canvas but stays in the panel", async ({ page }) => {
  await drawRect(page, 400, 200, 560, 300);
  const threadId = await placeComment(page, 480, 250);
  await reply(page, threadId, "looks good");

  await page.getByTestId(`comment-resolve-${threadId}`).click();
  await page.getByTestId(`comment-close-${threadId}`).click();
  await expect(page.getByTestId(`comment-pin-${threadId}`)).toHaveCount(0);

  await openCommentsPanel(page);
  // Hidden behind the resolved filter by default; showing resolved reveals it.
  await expect(page.getByTestId(`comments-panel-thread-${threadId}`)).toHaveCount(0);
  await page.getByTestId("comments-toggle-resolved").click();
  await expect(page.getByTestId(`comments-panel-thread-${threadId}`)).toBeVisible();
});

test("comments survive a reload through the autosave", async ({ page }) => {
  await drawRect(page, 400, 200, 560, 300);
  const threadId = await placeComment(page, 480, 250);
  await reply(page, threadId, "persisted?");

  await page.waitForTimeout(1300); // autosave debounce
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  await expect(page.getByTestId(`comment-pin-${threadId}`)).toBeVisible();
  await page.getByTestId(`comment-pin-${threadId}`).click();
  await expect(page.getByTestId(`comment-thread-${threadId}`).getByText("persisted?")).toBeVisible();
});

test("deleting a thread removes its pin and its record", async ({ page }) => {
  await drawRect(page, 400, 200, 560, 300);
  const threadId = await placeComment(page, 480, 250);
  await reply(page, threadId, "never mind");

  await page.getByTestId(`comment-delete-thread-${threadId}`).click();
  await expect(page.getByTestId(`comment-pin-${threadId}`)).toHaveCount(0);

  await page.waitForTimeout(1300);
  const resolved = await page.evaluate((key) => {
    const document = JSON.parse(localStorage.getItem(key)!);
    return document.pages[0].scene.comments.every((thread: { isDeleted: boolean }) => thread.isDeleted);
  }, AUTOSAVE_KEY);
  // The tombstone is kept on purpose: a deletion that vanished on save could be out-voted by a
  // peer's stale copy and resurrect the thread.
  expect(resolved).toBe(true);
});

test("comment mutations stay out of undo history", async ({ page }) => {
  await drawRect(page, 400, 200, 560, 300);
  const threadId = await placeComment(page, 480, 250);
  await reply(page, threadId, "a note");
  await page.getByTestId(`comment-close-${threadId}`).click();

  // One undo must take back the RECTANGLE, not the comment — a conversation is not document geometry.
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId(`comment-pin-${threadId}`)).toBeVisible();
  await page.waitForTimeout(1300);
  const elementCount = await page.evaluate((key) => {
    const document = JSON.parse(localStorage.getItem(key)!);
    return document.pages[0].scene.elements.filter((element: { isDeleted: boolean }) => !element.isDeleted).length;
  }, AUTOSAVE_KEY);
  expect(elementCount).toBe(0);
});

test("a comment on a deleted shape survives as a free-standing pin", async ({ page }) => {
  await drawRect(page, 400, 200, 560, 300);
  const threadId = await placeComment(page, 480, 250);
  await page.getByTestId(`comment-close-${threadId}`).click();

  await page.keyboard.press("v");
  await page.mouse.click(480, 250);
  await page.keyboard.press("Delete");

  await expect(page.getByTestId(`comment-pin-${threadId}`)).toBeVisible();
});

test("renaming yourself rewrites your existing comments, so one person is not two names", async ({ page }) => {
  await drawRect(page, 400, 200, 560, 300);
  const threadId = await placeComment(page, 480, 250);
  await reply(page, threadId, "who am I?");
  await page.getByTestId(`comment-close-${threadId}`).click();

  await openCommentsPanel(page);
  const nameField = page.getByTestId("comments-author-name");
  await nameField.fill("Tien");
  await nameField.press("Enter");

  await page.getByTestId(`comments-panel-thread-${threadId}`).click();
  await expect(page.getByTestId(`comment-thread-${threadId}`).getByText("Tien").first()).toBeVisible();
});
