import { test, expect } from "@playwright/test";
import { autosavedElements, clearFileDatabase, insertImage, patchColor, RED_BLUE_PNG, storedFileIds } from "./image-file-store-fixtures";

/**
 * The lifecycle of a stored image payload: when it is kept, when it is collected, and what happens
 * when the same image comes back after a collection. Split from `image-files-indexeddb.spec.ts`
 * (which covers where the bytes live) to keep both files near the house line limit.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await clearFileDatabase(page);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("re-adding an image whose bytes were collected stores them again", async ({ page }) => {
  await insertImage(page, RED_BLUE_PNG);
  await expect.poll(() => storedFileIds(page)).toHaveLength(1);

  // Orphan it and let a boot collect it.
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-reset").click();
  await expect.poll(async () => (await autosavedElements(page)).length).toBe(0);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect.poll(() => storedFileIds(page)).toHaveLength(0);

  // The same file again, in the same session that just collected it.
  await insertImage(page, RED_BLUE_PNG);
  await expect.poll(() => storedFileIds(page)).toHaveLength(1);

  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const left = await patchColor(page, viewport.width / 2 - 60, viewport.height / 2);
      return left.r > 150 && left.b < 100;
    })
    .toBe(true);
});

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
