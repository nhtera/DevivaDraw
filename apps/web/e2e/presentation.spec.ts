import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Presentation mode: frames walked as slides.
 *
 * The camera is the thing under test, so most assertions read the live camera out of the autosaved
 * document's parked viewport — which is also proof the walk moves the *real* camera rather than
 * painting a separate overlay view.
 */

const AUTOSAVE_KEY = "devivadraw:autosave:v1";

/** Three frames, deliberately out of scene order relative to their numeric prefixes. */
function threeFrameDocument(): unknown {
  const frame = (id: string, name: string, x: number, index: string) => ({
    id,
    type: "frame",
    name,
    x,
    y: 0,
    width: 400,
    height: 300,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundness: null,
    seed: 1,
    groupIds: [],
    frameId: null,
    boundElements: null,
    link: null,
    locked: false,
    index,
    version: 1,
    versionNonce: 1,
    updated: 1,
    isDeleted: false,
  });
  return {
    type: "devivadraw/document",
    schemaVersion: 1,
    activePageId: "p1",
    pages: [
      {
        id: "p1",
        name: "Deck",
        scene: {
          type: "devivadraw/scene",
          schemaVersion: 1,
          // Scene order is C, A, B; the numeric prefixes must reorder them to A, B, C.
          elements: [frame("f-c", "3. Third", 2000, "a003"), frame("f-a", "1. First", 0, "a001"), frame("f-b", "2. Second", 1000, "a002")],
          files: {},
          appState: { scrollX: 0, scrollY: 0, zoom: 1 },
        },
      },
    ],
  };
}

async function loadDeck(page: Page, doc: unknown = threeFrameDocument()): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ({ key, document }) => {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify(document));
    },
    { key: AUTOSAVE_KEY, document: doc },
  );
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
}

async function startPresenting(page: Page): Promise<void> {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-present").click();
  await expect(page.getByTestId("presentation-hud")).toBeVisible();
}

/** The parked camera from the autosaved document (waits out the autosave debounce). */
async function parkedCamera(page: Page): Promise<{ scrollX: number; scrollY: number; zoom: number }> {
  await page.waitForTimeout(1300);
  return page.evaluate((key) => {
    const doc = JSON.parse(localStorage.getItem(key)!);
    return doc.pages[0].scene.appState;
  }, AUTOSAVE_KEY);
}

/** Waits for the slide-transition animation to settle. */
async function settleTransition(page: Page): Promise<void> {
  await page.waitForTimeout(600);
}

test("walks frames in numeric-prefix order, not scene order", async ({ page }) => {
  await loadDeck(page);
  await startPresenting(page);

  await expect(page.getByTestId("presentation-counter")).toHaveText("1 / 3");
  await expect(page.getByTestId("presentation-slide-name")).toHaveText("1. First");
  await settleTransition(page);
  const first = await parkedCamera(page);

  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("presentation-counter")).toHaveText("2 / 3");
  await expect(page.getByTestId("presentation-slide-name")).toHaveText("2. Second");
  await settleTransition(page);
  const second = await parkedCamera(page);

  // Frame 2 sits 1000 units right of frame 1, so the camera must have scrolled left to centre it.
  expect(second.scrollX).toBeLessThan(first.scrollX - 500);

  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("presentation-counter")).toHaveText("1 / 3");
  await settleTransition(page);
  expect((await parkedCamera(page)).scrollX).toBeCloseTo(first.scrollX, 0);
});

test("Space and PageDown/PageUp also navigate", async ({ page }) => {
  await loadDeck(page);
  await startPresenting(page);

  await page.keyboard.press(" ");
  await expect(page.getByTestId("presentation-counter")).toHaveText("2 / 3");
  await page.keyboard.press("PageDown");
  await expect(page.getByTestId("presentation-counter")).toHaveText("3 / 3");
  await page.keyboard.press("PageUp");
  await expect(page.getByTestId("presentation-counter")).toHaveText("2 / 3");
});

test("navigation stops at both ends instead of wrapping", async ({ page }) => {
  await loadDeck(page);
  await startPresenting(page);

  await expect(page.getByTestId("presentation-prev")).toBeDisabled();
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("presentation-counter")).toHaveText("3 / 3");
  await expect(page.getByTestId("presentation-next")).toBeDisabled();
});

test("the HUD buttons navigate and exit", async ({ page }) => {
  await loadDeck(page);
  await startPresenting(page);

  await page.getByTestId("presentation-next").click();
  await expect(page.getByTestId("presentation-counter")).toHaveText("2 / 3");
  await page.getByTestId("presentation-prev").click();
  await expect(page.getByTestId("presentation-counter")).toHaveText("1 / 3");

  await page.getByTestId("presentation-exit").click();
  await expect(page.getByTestId("presentation-hud")).toHaveCount(0);
});

test("presenting hides the editor chrome, and Escape restores every bit of it", async ({ page }) => {
  await loadDeck(page);
  await expect(page.getByTestId("toolbar-select-tool")).toBeVisible();
  await expect(page.getByTestId("top-bar-menu")).toBeVisible();

  await startPresenting(page);
  await expect(page.getByTestId("toolbar-select-tool")).toHaveCount(0);
  await expect(page.getByTestId("top-bar-menu")).toHaveCount(0);
  await expect(page.getByTestId("library-toggle")).toHaveCount(0);
  await expect(page.getByTestId("minimap")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("presentation-hud")).toHaveCount(0);
  await expect(page.getByTestId("toolbar-select-tool")).toBeVisible();
  await expect(page.getByTestId("top-bar-menu")).toBeVisible();
  await expect(page.getByTestId("library-toggle")).toBeVisible();
});
