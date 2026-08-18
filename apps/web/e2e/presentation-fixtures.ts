import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Shared fixtures for the presentation specs — the walk, the lockdown guarantees, and what the
 * audience must not see. All three build the same deck and enter the same way, and the fixture was
 * duplicated verbatim across them before this file existed.
 */

export const AUTOSAVE_KEY = "devivadraw:autosave:v1";

export function frameElement(id: string, name: string, x: number, index: string, notes?: string): Record<string, unknown> {
  return {
    id,
    type: "frame",
    name,
    ...(notes === undefined ? {} : { notes }),
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
  };
}

/** Wraps `elements` in a one-page document the app will restore from its autosave slot. */
export function deckDocument(elements: readonly unknown[]): unknown {
  return {
    type: "devivadraw/document",
    schemaVersion: 1,
    activePageId: "p1",
    pages: [
      {
        id: "p1",
        name: "Deck",
        scene: { type: "devivadraw/scene", schemaVersion: 1, elements, files: {}, appState: { scrollX: 0, scrollY: 0, zoom: 1 } },
      },
    ],
  };
}

/** Three frames, deliberately out of scene order relative to their numeric prefixes. */
export function threeFrameDocument(): unknown {
  // Scene order is C, A, B; the numeric prefixes must reorder them to A, B, C.
  return deckDocument([frameElement("f-c", "3. Third", 2000, "a003"), frameElement("f-a", "1. First", 0, "a001"), frameElement("f-b", "2. Second", 1000, "a002")]);
}

export async function loadDeck(page: Page, doc: unknown = threeFrameDocument()): Promise<void> {
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

export async function startPresenting(page: Page): Promise<void> {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-present").click();
  await expect(page.getByTestId("presentation-hud")).toBeVisible();
}
