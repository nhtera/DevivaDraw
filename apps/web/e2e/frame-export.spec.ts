import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Per-frame PNG export — the export dialog's "Current frame only" scope.
 *
 * Split from `presentation.spec.ts`: it shares that feature's frame fixtures but is its own
 * capability (you export a frame without ever presenting), and keeping them together pushed the
 * file past the house line limit.
 */

const AUTOSAVE_KEY = "devivadraw:autosave:v1";

/** One frame at the origin — all these tests need is "the scene has (or has not) a frame". */
function frameDocument(withFrame: boolean): unknown {
  const frame = {
    id: "f-1",
    type: "frame",
    name: "1. First",
    x: 0,
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
    index: "a001",
    version: 1,
    versionNonce: 1,
    updated: 1,
    isDeleted: false,
  };
  return {
    type: "devivadraw/document",
    schemaVersion: 1,
    activePageId: "p1",
    pages: [{ id: "p1", name: "Deck", scene: { type: "devivadraw/scene", schemaVersion: 1, elements: withFrame ? [frame] : [], files: {}, appState: { scrollX: 0, scrollY: 0, zoom: 1 } } }],
  };
}

async function loadDeck(page: Page, withFrame: boolean): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ({ key, document }) => {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify(document));
    },
    { key: AUTOSAVE_KEY, document: frameDocument(withFrame) },
  );
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
}

async function openExportDialog(page: Page): Promise<void> {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-export-image").click();
}

test("the current-frame scope is offered when a frame exists", async ({ page }) => {
  await loadDeck(page, true);
  await openExportDialog(page);
  await expect(page.getByTestId("export-only-frame")).toBeEnabled();
});

test("the current-frame scope is disabled when the scene has no frames", async ({ page }) => {
  await loadDeck(page, false);
  await openExportDialog(page);
  await expect(page.getByTestId("export-only-frame")).toBeDisabled();
});

test("exporting the current frame downloads a PNG", async ({ page }) => {
  await loadDeck(page, true);
  await openExportDialog(page);
  await page.getByTestId("export-only-frame").check();

  const download = page.waitForEvent("download");
  await page.getByTestId("export-png").click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
});
