import { test, expect } from "@playwright/test";
import { autosaveText, autosavedElements, clearFileDatabase, insertImage, patchColor, RED_BLUE_PNG, storedFileIds } from "./image-file-store-fixtures";

/**
 * Image bytes live in IndexedDB, not in the localStorage autosave.
 *
 * The point of the change is a negative one — the autosave string must NOT contain the pixels — so
 * these specs assert against the real stored payload rather than against any app-reported state. The
 * budget spec is the one that matters most: an image large enough to have ended a session's autosave
 * outright now saves without complaint. Lifecycle (collection, re-adding, deletion) is the sibling
 * file's subject.
 */

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

// Found in a live browser, not by a unit test, because it lives in the seam between two boot-time
// jobs: collection deletes rows, and the autosave's memory of "already stored" is seeded from the
// same list. Seeded first, that memory names ids the database no longer has — so re-adding the same
// image (identical bytes ⇒ identical content-addressed id) is skipped as already-stored AND left out
// of the document. The bytes end up in neither place and the image is broken for good.
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
