import { test, expect } from "@playwright/test";
import { autosavedElements, clearFileDatabase, insertImage, patchColor, RED_BLUE_PNG, storedFileIds } from "./image-file-store-fixtures";
import { clearVersionDatabase, storedVersions, versionReferencedFileIds } from "./version-history-fixtures";

/**
 * The lifecycle of a stored image payload: when it is kept, when it is collected, and what happens
 * when the same image comes back after a collection. Split from `image-files-indexeddb.spec.ts`
 * (which covers where the bytes live) to keep both files near the house line limit.
 *
 * **Version history is the second owner of every image.** Clearing the canvas and opening another
 * document both take a milestone snapshot first, and that snapshot references the board's images by
 * id — so the bytes deliberately survive the collection that would once have taken them. That is not
 * a leak: a snapshot whose images had been collected would restore to a board of broken-image boxes,
 * which is the failure this project has already shipped three times. The specs below therefore assert
 * the two halves together — the bytes are kept while a version names them, and released once history
 * is cleared — because either half alone is satisfied by a bug.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await clearFileDatabase(page);
  await clearVersionDatabase(page);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

/** "Reset canvas", through the menu item that confirms first. Takes a `before-clear` milestone on its way. */
async function resetCanvas(page: import("@playwright/test").Page): Promise<void> {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-reset").click();
  await expect.poll(async () => (await autosavedElements(page)).length).toBe(0);
}

test("re-adding an image whose bytes were collected stores them again", async ({ page }) => {
  await insertImage(page, RED_BLUE_PNG);
  await expect.poll(() => storedFileIds(page)).toHaveLength(1);

  // Orphan it, and clear the version history that would otherwise keep it alive on the board's
  // behalf, so a boot really does collect.
  await resetCanvas(page);
  await clearVersionDatabase(page);
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

test("keeps a cleared board's images for the snapshot taken before the clear, and releases them when history goes", async ({ page }) => {
  await insertImage(page, RED_BLUE_PNG);
  await expect.poll(() => storedFileIds(page)).toHaveLength(1);
  const fileId = (await storedFileIds(page))[0]!;

  // "Reset canvas" clears the elements outright, tombstones included — the state in which the file
  // would once have been unreachable. It now leaves a milestone snapshot that still names it.
  await resetCanvas(page);
  await expect.poll(() => storedVersions(page)).toMatchObject([{ trigger: "milestone", label: "before-clear" }]);
  expect(await versionReferencedFileIds(page)).toEqual([fileId]);

  // Collection runs at boot. The bytes stay, because something still points at them — this is the
  // assertion that would have caught every one of this project's three lost-image bugs.
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect.poll(() => storedFileIds(page)).toEqual([fileId]);

  // And the other half: once the user empties their history, nothing owns the bytes and the next
  // collection takes them. A store that could not be emptied would be a leak.
  await clearVersionDatabase(page);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect.poll(() => storedFileIds(page)).toHaveLength(0);
});

/**
 * Opening a document is the other moment collection is safe: the board that was on screen is gone
 * along with its history, so its images cannot be undone back into existence. It is also the moment
 * version history takes a `before-open` milestone — precisely because that board is otherwise
 * unreachable — so the images now outlive the swap, and are released only when history is cleared.
 */
test("keeps the previous document's images for the snapshot taken before the open, and releases them when history goes", async ({ page }) => {
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
  await clearVersionDatabase(page);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await insertImage(page, RED_BLUE_PNG);
  await expect.poll(() => storedFileIds(page)).toHaveLength(1);
  const fileId = (await storedFileIds(page))[0]!;

  await page.getByTestId("top-bar-menu").click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("main-menu-open").click()]);
  await chooser.setFiles({ name: "other.devivadraw", mimeType: "application/json", buffer: Buffer.from(otherDocument) });
  await expect.poll(async () => (await autosavedElements(page)).some((element) => element.type === "rectangle")).toBe(true);

  // The swap itself collects — and finds the image still owned by the snapshot it just took.
  await expect.poll(() => versionReferencedFileIds(page)).toEqual([fileId]);
  await expect.poll(() => storedFileIds(page)).toEqual([fileId]);

  // Clear history, then switch pages: a page switch is a collection pass too, so the bytes go
  // without needing a reload — which is exactly the "collection runs on every rebuild" rule this
  // release had to keep honest.
  await clearVersionDatabase(page);
  await page.getByTestId("pages-toggle").click();
  await page.getByTestId("page-add").click();
  await expect.poll(() => storedFileIds(page)).toHaveLength(0);
});

/**
 * Collection runs on every runtime rebuild, and a page switch is one — so the keep-set has to be
 * right on every switch, not merely at boot. Called out separately because "we tested it at boot" is
 * exactly the assumption that would let a session lose a snapshot's images midway through an
 * afternoon of flipping between pages.
 */
test("keeps a snapshot's images across page switches, not just across boots", async ({ page }) => {
  await insertImage(page, RED_BLUE_PNG);
  await expect.poll(() => storedFileIds(page)).toHaveLength(1);
  const fileId = (await storedFileIds(page))[0]!;

  await resetCanvas(page);
  await expect.poll(() => versionReferencedFileIds(page)).toEqual([fileId]);

  // Several collection passes in a row, none of them a boot. The popover stays open across adds and
  // switches, so one toggle is all this needs.
  await page.getByTestId("pages-toggle").click();
  await page.getByTestId("page-add").click();
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 2");
  await page.locator('[data-testid^="page-item-"]').first().click();
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 1");
  await page.locator('[data-testid^="page-item-"]').last().click();
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 2");
  await expect.poll(() => storedFileIds(page)).toEqual([fileId]);

  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  expect(await storedFileIds(page)).toEqual([fileId]);
});

/**
 * The crash-recovery backup: when an autosave fails to restore cleanly, the raw payload is copied to
 * a `:recovery` slot so nothing is lost to the overwrite that follows. That payload names its images
 * without carrying them, and nothing reads the slot programmatically — so if collection reclaimed
 * those files, a rescue designed to lose nothing would quietly lose the pictures.
 */
test("keeps the images a crash-recovery backup still names", async ({ page }) => {
  await insertImage(page, RED_BLUE_PNG);
  await expect.poll(() => storedFileIds(page)).toHaveLength(1);
  const fileId = (await storedFileIds(page))[0]!;

  // Park the real document in the recovery slot, then leave the live slot with nothing referencing
  // the image — the state a salvaged restore produces.
  await page.evaluate(() => {
    const raw = localStorage.getItem("devivadraw:autosave:v1")!;
    localStorage.setItem("devivadraw:autosave:v1:recovery", raw);
    const document = JSON.parse(raw) as { pages: Array<{ scene: { elements: unknown[] } }> };
    document.pages[0]!.scene.elements = [];
    localStorage.setItem("devivadraw:autosave:v1", JSON.stringify(document));
  });
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  await expect.poll(() => storedFileIds(page)).toEqual([fileId]);
});
