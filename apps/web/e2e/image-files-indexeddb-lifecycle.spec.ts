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

/**
 * Opening a document is the other moment collection is safe: the board that was on screen is gone
 * along with its history, so its images cannot be undone back into existence. Waiting for the next
 * boot to notice would leave them on disk for the rest of the session.
 */
test("collects the previous document's images as soon as another document is opened", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker; // force the input fallback a test can drive
  });
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  // A document to open later, produced by the app itself rather than hand-written — a hand-built
  // element is one schema field away from being silently rejected, which would make this spec pass
  // for the wrong reason.
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(700, 300);
  await page.mouse.down();
  await page.mouse.move(820, 420, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await autosavedElements(page)).length).toBe(1);
  const otherDocument = await page.evaluate(() => localStorage.getItem("devivadraw:autosave:v1")!);

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await insertImage(page, RED_BLUE_PNG);
  await expect.poll(() => storedFileIds(page)).toHaveLength(1);

  await page.getByTestId("top-bar-menu").click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("main-menu-open").click()]);
  await chooser.setFiles({ name: "other.devivadraw", mimeType: "application/json", buffer: Buffer.from(otherDocument) });
  await expect.poll(async () => (await autosavedElements(page)).some((element) => element.type === "rectangle")).toBe(true);

  // No reload: the swap itself is what collects.
  await expect.poll(() => storedFileIds(page)).toHaveLength(0);
});
