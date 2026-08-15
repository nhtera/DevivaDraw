import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Binding an arrow to every closed shape — and the regression that got us here. Dropping an arrow
 * endpoint on a sticky note used to throw mid-gesture: the bind path reused the "can hold bound text"
 * predicate, which includes notes, to answer "does this element have an outline an arrow can attach
 * to", which they had no formula for. The throw landed before the tool closed its history batch, so
 * the arrow was lost and the next undo behaved unpredictably.
 *
 * Notes now bind for real, as do stars, clouds and the rest of the closed shapes. These assert the
 * user-visible half of that: no console error, the arrow commits bound, history stays clean, and the
 * endpoint is clipped outside the target rather than left where it was dropped.
 */

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

/** The persisted scene, after letting autosave flush. */
async function storedScene(page: Page) {
  await page.waitForTimeout(AUTOSAVE_FLUSH_MS);
  return page.evaluate(() => {
    const raw = localStorage.getItem("devivadraw:autosave:v1");
    if (!raw) return { elements: [] as Array<Record<string, unknown>> };
    return ((autosaved: unknown) => { const doc = autosaved as { pages?: Array<{ id: string; scene: unknown }>; activePageId?: string }; return doc.pages ? (doc.pages.find((entry) => entry.id === doc.activePageId) ?? doc.pages[0]!).scene : autosaved; })(JSON.parse(raw)) as { elements: Array<Record<string, unknown>> };
  });
}

async function storedArrows(page: Page) {
  const scene = await storedScene(page);
  return scene.elements.filter((element) => element.type === "arrow" && !element.isDeleted);
}

test("an arrow drawn onto a sticky note binds it, with no console error and a clean history", async ({ page }) => {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("pageerror", (error) => failures.push(error.message));

  await page.getByTestId("toolbar-note-tool").click();
  await drag(page, [NOTE.left, NOTE.top], [NOTE.right, NOTE.bottom]);

  await page.getByTestId("toolbar-arrow-tool").click();
  await drag(page, [350, 370], [NOTE.left - 10, 370]);

  expect(failures).toEqual([]);
  const arrows = await storedArrows(page);
  expect(arrows).toHaveLength(1);
  expect(arrows[0]!.endBinding).not.toBeNull();

  // The tool is not wedged: its batch closed, so exactly one undo removes the arrow and redo brings
  // it back — the note (drawn before it) survives both.
  await page.getByTestId("top-bar-undo").click();
  expect(await storedArrows(page)).toHaveLength(0);

  await page.getByTestId("top-bar-redo").click();
  expect(await storedArrows(page)).toHaveLength(1);

  expect(failures).toEqual([]);
});

test("an arrow binds to a star and to a cloud, clipping its endpoint outside each outline", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));

  for (const [tool, centre] of [
    ["more-star-tool", [520, 380]],
    ["more-cloud-tool", [820, 380]],
  ] as const) {
    await page.getByTestId("toolbar-more").click();
    await page.getByTestId(tool).click();
    await page.mouse.click(centre[0], centre[1]); // click-to-place a default-sized shape
  }

  // Right-to-left so the endpoint lands on the cloud's left side, starting inside the star.
  await page.getByTestId("toolbar-arrow-tool").click();
  await drag(page, [560, 380], [780, 380]);

  expect(failures).toEqual([]);
  const arrows = await storedArrows(page);
  expect(arrows).toHaveLength(1);
  expect(arrows[0]!.startBinding).not.toBeNull();
  expect(arrows[0]!.endBinding).not.toBeNull();
});

test("the arrow tool still binds to a rectangle after a note is on the canvas", async ({ page }) => {
  await page.getByTestId("toolbar-note-tool").click();
  await drag(page, [NOTE.left, NOTE.top], [NOTE.right, NOTE.bottom]);

  await page.getByTestId("toolbar-rectangle-tool").click();
  await drag(page, [330, 300], [470, 440]);

  await page.getByTestId("toolbar-arrow-tool").click();
  await drag(page, [480, 370], [NOTE.left - 10, 370]);

  const arrows = await storedArrows(page);
  expect(arrows[0]!.startBinding).not.toBeNull(); // the rectangle
  expect(arrows[0]!.endBinding).not.toBeNull(); // the note
});
