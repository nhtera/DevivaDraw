import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Image bytes live in IndexedDB, not in the localStorage autosave.
 *
 * The point of the change is a negative one — the autosave string must NOT contain the pixels — so
 * these specs assert against the real stored payload rather than against any app-reported state. The
 * budget spec is the one that matters most: an image large enough to have ended a session's autosave
 * outright now saves without complaint.
 */

const AUTOSAVE_KEY = "devivadraw:autosave:v1";
const FILE_DATABASE = "devivadraw-files";

/** A 200x100 PNG: left half red, right half blue — big enough to see on the canvas, small enough to paste around. */
const RED_BLUE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAMgAAABkCAYAAADDhn8LAAACKElEQVR4nO3OoQEAMBCEsN9/6daywSEQ8bl39+IhKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqBD1YGrNb1yxc1AAAAAElFTkSuQmCC";

/** Empties the file database without deleting it — a delete would block on the page's own open connection. */
async function clearFileDatabase(page: Page): Promise<void> {
  await page.evaluate(
    (databaseName) =>
      new Promise<void>((resolve) => {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("files")) request.result.createObjectStore("files");
        };
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("files", "readwrite");
          transaction.objectStore("files").clear();
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => resolve();
        };
        request.onerror = () => resolve();
      }),
    FILE_DATABASE,
  );
}

async function storedFileIds(page: Page): Promise<string[]> {
  return page.evaluate(
    (databaseName) =>
      new Promise<string[]>((resolve) => {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("files")) request.result.createObjectStore("files");
        };
        request.onsuccess = () => {
          const database = request.result;
          const keys = database.transaction("files", "readonly").objectStore("files").getAllKeys();
          keys.onsuccess = () => {
            resolve(keys.result.map(String));
            database.close();
          };
          keys.onerror = () => resolve([]);
        };
        request.onerror = () => resolve([]);
      }),
    FILE_DATABASE,
  );
}

const autosaveText = (page: Page) => page.evaluate((key) => localStorage.getItem(key) ?? "", AUTOSAVE_KEY);

/** The active page's live (non-deleted) elements, read straight out of the autosaved document. */
async function autosavedElements(page: Page): Promise<Array<{ type: string; fileId?: string }>> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { pages?: Array<{ id: string; scene: { elements: Array<{ type: string; fileId?: string; isDeleted?: boolean }> } }>; activePageId?: string };
    const scene = parsed.pages ? (parsed.pages.find((entry) => entry.id === parsed.activePageId) ?? parsed.pages[0]!).scene : (parsed as unknown as { elements: [] });
    return (scene.elements as Array<{ type: string; fileId?: string; isDeleted?: boolean }>).filter((element) => !element.isDeleted);
  }, AUTOSAVE_KEY);
}

async function insertImage(page: Page, base64: string): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("toolbar-image").click()]);
  await chooser.setFiles({ name: "swatch.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") });
  const viewport = page.viewportSize()!;
  await expect(async () => {
    await page.mouse.move(viewport.width / 2 - 1, viewport.height / 2);
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await expect(page.getByTestId("image-placement-ghost")).toBeVisible({ timeout: 200 });
  }).toPass();
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await expect.poll(async () => (await autosavedElements(page)).some((element) => element.type === "image")).toBe(true);
}

/** Mean colour of a patch of the static canvas layer — proof the image is really drawn, not just referenced. */
async function patchColor(page: Page, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
  return page.evaluate(
    ([px, py]) => {
      const canvas = document.querySelector('[data-testid="deviva-draw-canvas-host"]')!.querySelectorAll("canvas")[0]!;
      const dpr = window.devicePixelRatio || 1;
      const data = canvas.getContext("2d")!.getImageData(Math.round(px! * dpr), Math.round(py! * dpr), Math.round(6 * dpr), Math.round(6 * dpr)).data;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]!;
        g += data[i + 1]!;
        b += data[i + 2]!;
      }
      const pixels = data.length / 4;
      return { r: r / pixels, g: g / pixels, b: b / pixels };
    },
    [x, y],
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await clearFileDatabase(page);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("keeps image bytes out of the autosave document and in the file database", async ({ page }) => {
  await insertImage(page, RED_BLUE_PNG);

  await expect.poll(() => storedFileIds(page)).toHaveLength(1);
  // The whole point: the pixels are no longer competing with the document for the localStorage budget.
  await expect.poll(async () => (await autosaveText(page)).includes("data:image")).toBe(false);
  // ...and the element still knows which file is its own.
  expect((await autosavedElements(page)).find((element) => element.type === "image")?.fileId).toBeTruthy();
});

test("brings the image back on reload", async ({ page }) => {
  await insertImage(page, RED_BLUE_PNG);
  await expect.poll(() => storedFileIds(page)).toHaveLength(1);

  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  // The image is 200x100 at the viewport centre: red on its left half, blue on its right.
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const left = await patchColor(page, viewport.width / 2 - 60, viewport.height / 2);
      return left.r > 150 && left.b < 100;
    })
    .toBe(true);
  const right = await patchColor(page, viewport.width / 2 + 60, viewport.height / 2);
  expect(right.b).toBeGreaterThan(150);
  expect(right.r).toBeLessThan(100);
});

test("an image far larger than the localStorage budget saves without a storage warning", async ({ page }) => {
  // 1600x1600 of random noise — genuinely incompressible, so the PNG is several megabytes and its
  // base64 form larger still, comfortably past the ~5 MB an origin gets for localStorage. A patterned
  // fill would not do: PNG would squeeze it down to a few tens of kilobytes and the test would prove
  // nothing. Before the split, an image this size ended autosave for the session.
  const bigPng = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1600;
    const context = canvas.getContext("2d")!;
    const image = context.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = Math.floor(Math.random() * 256);
      image.data[i + 1] = Math.floor(Math.random() * 256);
      image.data[i + 2] = Math.floor(Math.random() * 256);
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  expect(bigPng.length).toBeGreaterThan(5 * 1024 * 1024);

  await insertImage(page, bigPng);

  await expect.poll(() => storedFileIds(page), { timeout: 15000 }).toHaveLength(1);
  await expect.poll(async () => (await autosaveText(page)).includes("data:image"), { timeout: 15000 }).toBe(false);
  // The document itself is now tiny — one element and a page envelope.
  expect((await autosaveText(page)).length).toBeLessThan(100 * 1024);
  await expect(page.getByTestId("autosave-quota-banner")).toHaveCount(0);
});

test("saving to a file still embeds the bytes, so the file stands on its own", async ({ page }) => {
  // Headless Chromium exposes `showSaveFilePicker`, whose native dialog no test can drive; stubbing
  // the picker (not the app) keeps the real save path under test and captures what it wrote.
  await page.addInitScript(() => {
    const state = window as unknown as { __savedFile?: string };
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = () => {
      let content = "";
      return Promise.resolve({
        createWritable: () =>
          Promise.resolve({
            write: (data: string) => {
              content = data;
              return Promise.resolve();
            },
            close: () => {
              state.__savedFile = content;
              return Promise.resolve();
            },
          }),
      });
    };
  });
  await insertImage(page, RED_BLUE_PNG);
  await expect.poll(() => storedFileIds(page)).toHaveLength(1);

  // Reload first: this is the case that would break without the load gate — a save whose bytes only
  // exist in the database the document is still reading back.
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-save").click();

  await expect.poll(() => page.evaluate(() => (window as unknown as { __savedFile?: string }).__savedFile?.includes("data:image/png;base64,"))).toBe(true);
});

// Deleting is not the same as being gone: the autosave keeps tombstones so a delete survives a
// reload, and a tombstoned image is still a reference. Collecting its bytes would leave the
// restored element pointing at nothing — the same rule `Scene.pruneOrphanedFiles` documents.
test("keeps the bytes of a deleted image, which is still one undo from coming back", async ({ page }) => {
  await insertImage(page, RED_BLUE_PNG);
  await expect.poll(() => storedFileIds(page)).toHaveLength(1);

  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await autosavedElements(page)).length).toBe(0);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  expect(await storedFileIds(page)).toHaveLength(1);
});

test("collects the stored bytes once the document no longer mentions them at all", async ({ page }) => {
  await insertImage(page, RED_BLUE_PNG);
  await expect.poll(() => storedFileIds(page)).toHaveLength(1);

  // "Reset canvas" clears the elements outright, tombstones included — the state in which the file
  // really is unreachable.
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-reset").click();
  await expect.poll(async () => (await autosavedElements(page)).length).toBe(0);

  // Collection runs at boot, the one moment nothing can be undone back into existence.
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  await expect.poll(() => storedFileIds(page)).toHaveLength(0);
});
