import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Dropping a document file straight onto the canvas (Excalidraw parity): a scene file replaces the
 * drawing, a library file is shelved. Images have their own drop path and are covered elsewhere.
 */

const EXCALIDRAW_SCENE = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [
    { type: "rectangle", id: "dropped-a", x: 100, y: 100, width: 80, height: 60, strokeColor: "#1e1e1e", backgroundColor: "transparent" },
    { type: "ellipse", id: "dropped-b", x: 220, y: 100, width: 80, height: 60, strokeColor: "#1e1e1e", backgroundColor: "transparent" },
  ],
  appState: { viewBackgroundColor: "#ffffff" },
};

const EXCALIDRAW_LIBRARY = {
  type: "excalidrawlib",
  version: 2,
  libraryItems: [
    { id: "lib-a", status: "published", name: "Server", elements: [{ type: "rectangle", id: "s1", x: 0, y: 0, width: 60, height: 40 }] },
    { id: "lib-b", status: "published", name: "Client", elements: [{ type: "ellipse", id: "c1", x: 0, y: 0, width: 60, height: 40 }] },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

/** Dispatches a real `drop` carrying one file, the way dragging it in from the desktop would. */
async function dropFile(page: Page, name: string, contents: unknown): Promise<void> {
  const dataTransfer = await page.evaluateHandle(
    ([fileName, json]) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([json!], fileName!, { type: "application/json" }));
      return transfer;
    },
    [name, JSON.stringify(contents)],
  );
  await page.getByTestId("deviva-draw-canvas-host").dispatchEvent("drop", { dataTransfer });
}

/** Non-deleted element count from the persisted scene — deletes are tombstones, so `isDeleted` has to be filtered. */
async function liveElementCount(page: Page): Promise<number> {
  await page.waitForTimeout(1300); // autosave debounce
  return page.evaluate(() => {
    const raw = localStorage.getItem("devivadraw:autosave:v1");
    if (!raw) return 0;
    const scene = JSON.parse(raw) as { elements: Array<{ isDeleted?: boolean }> };
    return scene.elements.filter((element) => !element.isDeleted).length;
  });
}

async function drawRect(page: Page): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(360, 300);
  await page.mouse.down();
  await page.mouse.move(480, 400);
  await page.mouse.up();
}

test("dropping a scene file loads it, replacing whatever was on the canvas", async ({ page }) => {
  await drawRect(page);
  expect(await liveElementCount(page)).toBe(1);

  await dropFile(page, "diagram.excalidraw", EXCALIDRAW_SCENE);

  // The dropped document's two elements, and none of the drawing it replaced — the same semantics as
  // opening the file through the menu.
  await expect.poll(() => liveElementCount(page)).toBe(2);
});

test("dropping a library file shelves it and opens the sidebar, leaving the drawing alone", async ({ page }) => {
  await drawRect(page);

  await dropFile(page, "shapes.excalidrawlib", EXCALIDRAW_LIBRARY);

  // Opened, so the items land somewhere visible instead of on a shelf the user cannot see...
  await expect(page.getByTestId("library-panel")).toBeVisible();
  await expect(page.getByTestId("library-item")).toHaveCount(2);
  // ...and the canvas still holds exactly what was drawn before the drop.
  expect(await liveElementCount(page)).toBe(1);
});

test("a library dropped while the sidebar is already open shows up without reopening it", async ({ page }) => {
  await page.getByTestId("library-toggle").click();
  await expect(page.getByTestId("library-panel")).toBeVisible();
  await expect(page.getByTestId("library-item")).toHaveCount(0);

  // The panel reads the shelf into state once, on mount; a write from outside has to notify it.
  await dropFile(page, "shapes.excalidrawlib", EXCALIDRAW_LIBRARY);
  await expect(page.getByTestId("library-item")).toHaveCount(2);
});

test("a file that is neither format leaves the drawing untouched", async ({ page }) => {
  await drawRect(page);

  await dropFile(page, "notes.txt", { something: "unrelated" });

  await expect(page.getByTestId("library-panel")).toHaveCount(0);
  expect(await liveElementCount(page)).toBe(1);
});
