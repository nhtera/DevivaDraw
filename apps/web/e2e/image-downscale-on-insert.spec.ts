import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * An oversized image is resized and inserted, and the user is told — on screen, not in the console.
 *
 * The old behaviour refused anything over 10 MB, a cap written when every byte went into the
 * localStorage autosave (image bytes moved to IndexedDB in 0.10), and reported the refusal by
 * `console.warn` — so dropping a phone photo looked exactly like dropping nothing at all. Both
 * halves are asserted here: the element must appear, and the notice must be in the DOM.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

/**
 * A real PNG, drawn in the page so the browser will decode it, at whatever size is asked for. Padded
 * with an incompressible noise pattern when `padToBytes` is given, so "over the byte budget" can be
 * reached without a 10 MB fixture in the repo.
 */
async function pngFile(page: Page, width: number, height: number): Promise<{ dataURL: string }> {
  return page.evaluate(
    ({ width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      // Noise rather than flat colour: a flat PNG of this size compresses to almost nothing, which
      // would defeat the point of a size-based test.
      const image = context.createImageData(width, Math.min(height, 512));
      for (let index = 0; index < image.data.length; index += 4) {
        image.data[index] = (index * 7) % 256;
        image.data[index + 1] = (index * 13) % 256;
        image.data[index + 2] = (index * 29) % 256;
        image.data[index + 3] = 255;
      }
      for (let y = 0; y < height; y += 512) context.putImageData(image, 0, y);
      return { dataURL: canvas.toDataURL("image/png") };
    },
    { width, height },
  );
}

/** Dispatches a real `drop` carrying one image file, the way dragging it in from the desktop would. */
async function dropImage(page: Page, dataURL: string, name = "photo.png"): Promise<void> {
  const dataTransfer = await page.evaluateHandle(
    async ([url, fileName]) => {
      const blob = await (await fetch(url!)).blob();
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], fileName!, { type: blob.type }));
      return transfer;
    },
    [dataURL, name],
  );
  await page.getByTestId("deviva-draw-canvas-host").dispatchEvent("drop", { dataTransfer });
}

/** The inserted image elements from the persisted scene. */
async function imageElements(page: Page): Promise<Array<{ naturalWidth: number; naturalHeight: number }>> {
  await page.waitForTimeout(1300); // autosave debounce
  return page.evaluate(() => {
    const raw = localStorage.getItem("devivadraw:autosave:v1");
    if (!raw) return [];
    const scene = ((autosaved: unknown) => { const doc = autosaved as { pages?: Array<{ id: string; scene: unknown }>; activePageId?: string }; return doc.pages ? (doc.pages.find((entry) => entry.id === doc.activePageId) ?? doc.pages[0]!).scene : autosaved; })(JSON.parse(raw)) as { elements: Array<{ type: string; isDeleted?: boolean; naturalWidth: number; naturalHeight: number }> };
    return scene.elements.filter((element) => element.type === "image" && !element.isDeleted).map(({ naturalWidth, naturalHeight }) => ({ naturalWidth, naturalHeight }));
  });
}

test("an image over the pixel budget is downscaled, inserted, and announced on screen", async ({ page }) => {
  const { dataURL } = await pngFile(page, 12000, 600);
  await dropImage(page, dataURL);

  await expect(page.getByTestId("image-insert-notice")).toBeVisible();
  await expect(page.getByTestId("image-insert-notice")).toHaveAttribute("data-outcome", "resized");

  const images = await imageElements(page);
  expect(images).toHaveLength(1);
  // Stored pixels, not the original's: every export scales against these.
  expect(images[0]!.naturalWidth).toBe(8000);
  expect(images[0]!.naturalHeight).toBe(400);
});

test("an image inside every budget inserts silently, with no notice at all", async ({ page }) => {
  const { dataURL } = await pngFile(page, 800, 600);
  await dropImage(page, dataURL);

  const images = await imageElements(page);
  expect(images).toHaveLength(1);
  expect(images[0]!.naturalWidth).toBe(800);
  await expect(page.getByTestId("image-insert-notice")).toBeHidden();
});

test("a decompression bomb is refused with a message that names its size, and the tab survives", async ({ page }) => {
  // A hand-built PNG header declaring 30000x30000 (900 megapixels, ~3.6 GB decoded) in a few dozen
  // bytes. Nothing decodes it: the refusal is decided from the header alone.
  const bombDataURL = await page.evaluate(() => {
    const header = new Uint8Array(80);
    header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(header.buffer);
    view.setUint32(8, 13); // IHDR length
    header.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
    view.setUint32(16, 30000);
    view.setUint32(20, 30000);
    let binary = "";
    for (const byte of header) binary += String.fromCharCode(byte);
    return `data:image/png;base64,${btoa(binary)}`;
  });
  await dropImage(page, bombDataURL, "bomb.png");

  const notice = page.getByTestId("image-insert-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("data-outcome", "too-many-pixels");
  await expect(notice).toContainText("30000×30000");
  expect(await imageElements(page)).toHaveLength(0);

  // The page is still alive and usable, which is the other half of "rejected safely".
  await page.getByTestId("toolbar-rectangle-tool").click();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("the notice can be dismissed by hand before it times out", async ({ page }) => {
  const { dataURL } = await pngFile(page, 12000, 600);
  await dropImage(page, dataURL);

  await expect(page.getByTestId("image-insert-notice")).toBeVisible();
  await page.getByTestId("image-insert-notice-dismiss").click();
  await expect(page.getByTestId("image-insert-notice")).toBeHidden();
});
