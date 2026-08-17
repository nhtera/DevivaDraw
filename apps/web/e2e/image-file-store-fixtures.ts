import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Shared fixtures for the two image-file-store specs: the same board state has to be built,
 * inspected in two different stores, and compared against the painted pixels, and neither spec
 * file should own that machinery alone.
 */

export const AUTOSAVE_KEY = "devivadraw:autosave:v1";
const FILE_DATABASE = "devivadraw-files";

/** A 200x100 PNG: left half red, right half blue — big enough to see on the canvas, small enough to paste around. */
export const RED_BLUE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAMgAAABkCAYAAADDhn8LAAACKElEQVR4nO3OoQEAMBCEsN9/6daywSEQ8bl39+IhKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqBD1YGrNb1yxc1AAAAAElFTkSuQmCC";

/** Empties the file database without deleting it — a delete would block on the page's own open connection. */
export async function clearFileDatabase(page: Page): Promise<void> {
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

export async function storedFileIds(page: Page): Promise<string[]> {
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

export const autosaveText = (page: Page) => page.evaluate((key) => localStorage.getItem(key) ?? "", AUTOSAVE_KEY);

/** The active page's live (non-deleted) elements, read straight out of the autosaved document. */
export async function autosavedElements(page: Page): Promise<Array<{ type: string; fileId?: string }>> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { pages?: Array<{ id: string; scene: { elements: Array<{ type: string; fileId?: string; isDeleted?: boolean }> } }>; activePageId?: string };
    const scene = parsed.pages ? (parsed.pages.find((entry) => entry.id === parsed.activePageId) ?? parsed.pages[0]!).scene : (parsed as unknown as { elements: [] });
    return (scene.elements as Array<{ type: string; fileId?: string; isDeleted?: boolean }>).filter((element) => !element.isDeleted);
  }, AUTOSAVE_KEY);
}

export async function insertImage(page: Page, base64: string): Promise<void> {
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
export async function patchColor(page: Page, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
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
