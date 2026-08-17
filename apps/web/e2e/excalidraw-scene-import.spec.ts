import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Opening an Excalidraw `.excalidraw` scene file. The library import's sibling: same element mapping,
 * different envelope — one flat element array plus an `appState` and a `files` sidecar.
 *
 * Images are the reason this path differs from the library one. A scene carries the bytes, so an
 * `image` element imports; a library item has nowhere to put them, so it stays skipped there.
 */

/** A 1x1 PNG — enough to exercise the sidecar → file-store → render pipeline. */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const SCENE_FILE = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  appState: { viewBackgroundColor: "#f5faff" },
  elements: [
    { type: "rectangle", id: "r1", x: 100, y: 100, width: 160, height: 90, strokeColor: "#1971c2", backgroundColor: "#a5d8ff", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, angle: 0, seed: 1, groupIds: [], roundness: { type: 3 }, boundElements: [{ id: "t1", type: "text" }] },
    { type: "text", id: "t1", x: 110, y: 130, width: 140, height: 25, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 1, opacity: 100, angle: 0, seed: 2, groupIds: [], text: "Imported", originalText: "Imported", fontSize: 20, fontFamily: 1, textAlign: "center", verticalAlign: "middle", containerId: "r1" },
    { type: "image", id: "i1", x: 320, y: 100, width: 90, height: 90, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 1, opacity: 100, angle: 0, seed: 3, groupIds: [], fileId: "file-a" },
  ],
  files: { "file-a": { id: "file-a", mimeType: "image/png", dataURL: PNG, created: 1700000000000 } },
};

test.beforeEach(async ({ page }) => {
  // Force the `<input type="file">` fallback: Chromium's native File System Access dialog is out of
  // Playwright's reach, so the fallback is the only branch a test can drive.
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function openFile(page: Page, contents: unknown, name: string): Promise<void> {
  await page.getByTestId("top-bar-menu").click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("main-menu-open").click()]);
  await chooser.setFiles({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(contents)) });
}

/** The persisted scene, after the autosave debounce. */
async function storedScene(page: Page) {
  await page.waitForTimeout(1300);
  return page.evaluate(() => {
    const raw = localStorage.getItem("devivadraw:autosave:v1");
    return ((autosaved: unknown) => { const doc = autosaved as { pages?: Array<{ id: string; scene: unknown }>; activePageId?: string }; return doc.pages ? (doc.pages.find((entry) => entry.id === doc.activePageId) ?? doc.pages[0]!).scene : autosaved; })(JSON.parse(raw!)) as {
      elements: Array<Record<string, unknown>>;
      files?: Record<string, unknown>;
      appState?: { background?: string };
    };
  });
}

test("opening an .excalidraw scene loads its elements, bound text and canvas background", async ({ page }) => {
  await openFile(page, SCENE_FILE, "diagram.excalidraw");

  const scene = await storedScene(page);
  const live = scene.elements.filter((element) => !element.isDeleted);
  expect(live.map((element) => element.type).sort()).toEqual(["image", "rectangle", "text"]);

  // The container/label link survived the id round-trip.
  const rectangle = live.find((element) => element.type === "rectangle")!;
  const text = live.find((element) => element.type === "text")!;
  expect(text.containerId).toBe(rectangle.id);
  expect(text.text).toBe("Imported");
  // Excalidraw stores it as `appState.viewBackgroundColor`; this app's document uses `appState.background`.
  expect(scene.appState?.background).toBe("#f5faff");

  // `{type: 3}` is Excalidraw's modern rounded-corner mode; this renderer implements one mode, so it
  // has to arrive normalized or the rectangle draws with sharp corners.
  expect(rectangle.roundness).toEqual({ type: 1 });
});

test("an image comes across with its bytes, not as a broken reference", async ({ page }) => {
  await openFile(page, SCENE_FILE, "diagram.excalidraw");

  const scene = await storedScene(page);
  const image = scene.elements.find((element) => element.type === "image")!;

  // The element's `fileId` has to resolve to real bytes — an `ImageElement` whose file never made it
  // across renders as a permanently empty box. The bytes live in the image database rather than in
  // the autosave document (see `image-files-indexeddb.spec.ts`), so that is where they are checked.
  await expect
    .poll(() =>
      page.evaluate(
        (fileId) =>
          new Promise<string | null>((resolve) => {
            const request = indexedDB.open("devivadraw-files", 1);
            request.onupgradeneeded = () => {
              if (!request.result.objectStoreNames.contains("files")) request.result.createObjectStore("files");
            };
            request.onsuccess = () => {
              const database = request.result;
              const read = database.transaction("files", "readonly").objectStore("files").get(fileId);
              read.onsuccess = () => {
                resolve((read.result as { dataURL?: string } | undefined)?.dataURL ?? null);
                database.close();
              };
              read.onerror = () => resolve(null);
            };
            request.onerror = () => resolve(null);
          }),
        image.fileId as string,
      ),
    )
    .toBe(PNG);
});

test("a .devivadraw file still opens — the Excalidraw branch did not take over the format check", async ({ page }) => {
  // Draw something, save it through the app's own serializer, then re-open that exact payload.
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(300, 250);
  await page.mouse.down();
  await page.mouse.move(420, 340);
  await page.mouse.up();

  const own = await storedScene(page); // waits for the autosave debounce before reading
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await openFile(page, own, "scene.devivadraw");

  const scene = await storedScene(page);
  expect(scene.elements.filter((element) => !element.isDeleted && element.type === "rectangle")).toHaveLength(1);
});

test("a library file offered to Open is rejected instead of loading as an empty scene", async ({ page }) => {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(300, 250);
  await page.mouse.down();
  await page.mouse.move(420, 340);
  await page.mouse.up();

  await openFile(page, { type: "excalidrawlib", version: 2, libraryItems: [] }, "shapes.excalidrawlib");

  // The existing drawing is untouched — a wrong file must never silently blank the canvas.
  const scene = await storedScene(page);
  expect(scene.elements.filter((element) => !element.isDeleted)).toHaveLength(1);
});
