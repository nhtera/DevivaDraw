import { test, expect } from "@playwright/test";
import { RED_BLUE_PNG, clearFileDatabase, insertImage, patchColor, storedFileIds } from "./image-file-store-fixtures";

/**
 * A library item stores which image it uses, never the image itself. That makes the library the one
 * owner of file data that lives outside the document — so collection has to count it, and placing an
 * item has to read the bytes back. Get either wrong and the failure is quietly nasty: the saved
 * thumbnail (rendered while the board still held the image) keeps looking perfect while the item
 * places a broken box.
 */

async function openLibrary(page: import("@playwright/test").Page): Promise<void> {
  if (!(await page.getByTestId("library-panel").isVisible())) await page.getByTestId("library-toggle").click();
  await expect(page.getByTestId("library-panel")).toBeVisible();
}

/** Clears the board outright — tombstones included — so nothing on it references the image any more. */
async function resetCanvas(page: import("@playwright/test").Page): Promise<void> {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-reset").click();
  await page.waitForTimeout(1500); // let the autosave land before the reload
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await clearFileDatabase(page);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("an image saved to the library still places as an image after the board is cleared", async ({ page }) => {
  await insertImage(page, RED_BLUE_PNG);
  await openLibrary(page);
  await page.getByTestId("library-add").click();
  await expect(page.getByTestId("library-item")).toHaveCount(1);
  await expect.poll(() => storedFileIds(page)).toHaveLength(1);

  await resetCanvas(page);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  // Collection ran on that boot and must have spared the file: the library still points at it.
  await expect.poll(() => storedFileIds(page)).toHaveLength(1);

  await openLibrary(page);
  await page.getByTestId("library-item").click();

  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const left = await patchColor(page, viewport.width / 2 - 40, viewport.height / 2);
      return left.r > 200 && left.g < 60 && left.b < 60; // the image's red half, not the pink broken box
    })
    .toBe(true);
  const right = await patchColor(page, viewport.width / 2 + 40, viewport.height / 2);
  expect(right.b).toBeGreaterThan(200);
});

test("deleting the library item lets the bytes go", async ({ page }) => {
  await insertImage(page, RED_BLUE_PNG);
  await openLibrary(page);
  await page.getByTestId("library-add").click();
  await expect(page.getByTestId("library-item")).toHaveCount(1);
  await expect.poll(() => storedFileIds(page)).toHaveLength(1);

  await resetCanvas(page);
  await page.evaluate(() => localStorage.removeItem("devivadraw:library:v1"));
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  // Nothing refers to it now — not the board, not the library.
  await expect.poll(() => storedFileIds(page)).toHaveLength(0);
});
