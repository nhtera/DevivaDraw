import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Regression: dropping an arrow endpoint on a sticky note threw mid-gesture. The bind path reused
 * the "can hold bound text" predicate, which includes notes, to answer "does this have a border an
 * arrow can attach to", which they did not — so `intersectShapeBorder` fell off the end of its type
 * switch and returned `undefined`. The throw landed before the tool closed its history batch, so the
 * arrow tool was left wedged and the next undo behaved unpredictably.
 *
 * Notes still do not bind (that geometry lands separately) — what this asserts is that drawing onto
 * one is uneventful: no console error, the arrow commits, and history stays clean.
 */

/** Kept clear of the left properties panel, which covers roughly the first 280px of the viewport. */
const NOTE = { left: 600, top: 300, right: 760, bottom: 440 } as const;
const AUTOSAVE_FLUSH_MS = 1300;

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

/** Arrow count in the persisted scene, after letting autosave flush. */
async function storedArrowCount(page: Page): Promise<number> {
  await page.waitForTimeout(AUTOSAVE_FLUSH_MS);
  return page.evaluate(() => {
    const raw = localStorage.getItem("devivadraw:autosave:v1");
    if (!raw) return 0;
    const scene = JSON.parse(raw) as { elements: Array<{ type: string; isDeleted?: boolean }> };
    return scene.elements.filter((element) => element.type === "arrow" && !element.isDeleted).length;
  });
}

test("an arrow drawn onto a sticky note commits cleanly, with no console error and a clean history", async ({ page }) => {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("pageerror", (error) => failures.push(error.message));

  await page.getByTestId("toolbar-note-tool").click();
  await drag(page, [NOTE.left, NOTE.top], [NOTE.right, NOTE.bottom]);

  // Endpoint lands just short of the note's left edge — inside the bind proximity threshold, which
  // is exactly the case that used to throw.
  await page.getByTestId("toolbar-arrow-tool").click();
  await drag(page, [350, 370], [NOTE.left - 10, 370]);

  expect(failures).toEqual([]);
  expect(await storedArrowCount(page)).toBe(1);

  // The tool is not wedged: its batch closed, so exactly one undo removes the arrow and redo brings
  // it back — the note (drawn before it) survives both.
  await page.getByTestId("top-bar-undo").click();
  expect(await storedArrowCount(page)).toBe(0);

  await page.getByTestId("top-bar-redo").click();
  expect(await storedArrowCount(page)).toBe(1);

  expect(failures).toEqual([]);
});

test("the arrow tool still binds to a rectangle after a note is on the canvas", async ({ page }) => {
  await page.getByTestId("toolbar-note-tool").click();
  await drag(page, [NOTE.left, NOTE.top], [NOTE.right, NOTE.bottom]);

  await page.getByTestId("toolbar-rectangle-tool").click();
  await drag(page, [330, 300], [470, 440]);

  await page.getByTestId("toolbar-arrow-tool").click();
  await drag(page, [480, 370], [NOTE.left - 10, 370]);

  await page.waitForTimeout(AUTOSAVE_FLUSH_MS);
  const bindings = await page.evaluate(() => {
    const raw = localStorage.getItem("devivadraw:autosave:v1")!;
    const scene = JSON.parse(raw) as { elements: Array<Record<string, unknown>> };
    const arrow = scene.elements.find((element) => element.type === "arrow")!;
    return { start: arrow.startBinding as { elementId: string } | null, end: arrow.endBinding };
  });

  expect(bindings.start).not.toBeNull(); // rectangle end bound as before
  expect(bindings.end).toBeNull(); // note end left unbound rather than throwing
});
