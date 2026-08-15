import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The shared viewer's honesty contract: view-only genuinely blocks editing (no toolbar, tool
 * shortcuts dead, pan-only pointer), one prominent "Edit a copy" pill unlocks a local in-memory
 * copy (with a persistent unsaved-copy chip, since a share-viewer session has no autosave), and the
 * sharer's own board/blob is never touched. Plus the share dialog's snapshot-vs-live clarity: a
 * frozen-snapshot note and a one-click path to live collaboration.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

/** Draw the sharer's rectangle and mint a share link against an intercepted blob store. */
async function shareARectangle(page: Page): Promise<string> {
  let storedBlob: Buffer | null = null;
  await page.route("**/blobs/**", async (route) => {
    if (route.request().method() === "PUT") {
      storedBlob = route.request().postDataBuffer();
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/octet-stream", body: storedBlob! });
  });

  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(600, 420);
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1300); // let the autosave debounce write the sharer's own board

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-share").click();
  await page.getByTestId("share-dialog-regenerate").click(); // opening no longer auto-mints — creating a link is explicit
  const url = await page.getByTestId("share-dialog-link").inputValue();
  await page.getByTestId("share-dialog-overlay").click({ position: { x: 5, y: 5 } });
  return url;
}

async function cursorAt(page: Page, x: number, y: number): Promise<string> {
  await page.mouse.move(x, y);
  await page.waitForTimeout(200); // cursor applies on the next frame
  return page.getByTestId("deviva-draw-canvas-host").evaluate((host) => (host as HTMLElement).style.cursor);
}

test("the shared viewer blocks editing until 'Edit a copy', which unlocks a local copy without touching the original", async ({ page }) => {
  const shareUrl = await shareARectangle(page);

  await page.goto(shareUrl);
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect(page.getByTestId("share-viewer-edit-copy")).toBeVisible();

  // Genuinely read-only: no toolbar, the pointer is pan-only, and tool shortcuts are dead.
  await expect(page.getByTestId("toolbar-rectangle-tool")).toHaveCount(0);
  expect(await cursorAt(page, 500, 360)).toBe("grab");
  await page.keyboard.press("r");
  expect(await cursorAt(page, 500, 360)).toBe("grab"); // still the pan cursor — the shortcut was blocked

  // The registry-bypassing input paths are dead too: the image-insert shortcut opens no picker,
  // and the stats panel (whose fields write to the scene) won't open.
  let imagePickerOpened = false;
  page.on("filechooser", () => {
    imagePickerOpened = true;
  });
  await page.keyboard.press("9");
  await page.waitForTimeout(300);
  expect(imagePickerOpened).toBe(false);
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-toggle-stats").click();
  await expect(page.getByTestId("stats-panel")).toHaveCount(0);
  await page.keyboard.press("Escape"); // close the menu if it's still up

  // One click → a real editor on a local copy.
  await page.getByTestId("share-viewer-edit-copy").click();
  await expect(page.getByTestId("share-viewer-unsaved")).toBeVisible();
  await expect(page.getByTestId("toolbar-rectangle-tool")).toBeVisible();

  await page.getByTestId("toolbar-ellipse-tool").click();
  await page.mouse.move(700, 500);
  await page.mouse.down();
  await page.mouse.move(800, 560);
  await page.mouse.up();
  expect(await cursorAt(page, 750, 530)).toBe("move"); // the new element exists in the copy

  // The sharer's own board was never touched by any of this: the autosave slot still holds exactly
  // the one original rectangle (the viewer session has no autosave — its edits stay in memory).
  const savedElements = await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!) as { pages: { scene: { elements: { isDeleted?: boolean }[] } }[] };
    return doc.pages.flatMap((entry) => entry.scene.elements).filter((element) => !element.isDeleted).length;
  });
  expect(savedElements).toBe(1);
});

test("toggling view-only in the editor round-trips: pan while on, select and editable again after", async ({ page }) => {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(400, 380);
  await page.mouse.up();
  await page.keyboard.press("Escape");

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-toggle-view-only").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("toolbar-rectangle-tool")).toHaveCount(0); // toolbar gone, pan pinned

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-toggle-view-only").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("toolbar-select-tool")).toHaveAttribute("aria-pressed", "true"); // select handed back on the exit edge
  await page.mouse.move(350, 340);
  await page.mouse.down();
  await page.mouse.move(500, 340);
  await page.mouse.up(); // dragging the rect works again — editing genuinely restored
});

test("the share dialog states snapshot semantics and cross-links live collaboration", async ({ page }) => {
  await page.route("**/blobs/**", (route) => route.fulfill({ status: 204 }));
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(400, 380);
  await page.mouse.up();

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-share").click();
  await page.getByTestId("share-dialog-regenerate").click(); // opening no longer auto-mints — creating a link is explicit
  await expect(page.getByTestId("share-dialog-snapshot-note")).toBeVisible();

  await page.getByTestId("share-dialog-start-collab").click();
  await expect(page.getByTestId("share-dialog")).toHaveCount(0);
  await expect(page.getByTestId("collab-dialog")).toBeVisible();
});
