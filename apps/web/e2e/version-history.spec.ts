import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { autosavedElements, clearFileDatabase, insertImage, patchColor, RED_BLUE_PNG, storedFileIds } from "./image-file-store-fixtures";
import { clearVersionDatabase, storedVersions } from "./version-history-fixtures";

/**
 * Version history, from the panel a user actually touches.
 *
 * The image test is the one that earns its runtime. A snapshot stores its document with the pixels
 * excluded and referenced by id, so "restore brings the image back" depends on three separate things
 * being right at once — the snapshot naming the file, orphan collection sparing it, and the restore
 * rehydrating it. Every one of this project's historical file-lifecycle bugs would have failed here
 * and nowhere in the unit suite.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await clearFileDatabase(page);
  await clearVersionDatabase(page);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function drawRect(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 6 });
  await page.mouse.up();
}

async function openHistory(page: Page): Promise<void> {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-version-history").click();
  await expect(page.getByTestId("version-history-panel")).toBeVisible();
}

/** Saves a named version through the panel's own "Save version…" flow. */
async function saveVersion(page: Page, label: string): Promise<void> {
  await page.getByTestId("version-history-save").click();
  await page.getByTestId("version-history-save-input").fill(label);
  await page.getByTestId("version-history-save-input").press("Enter");
  await expect(page.getByTestId("version-history-list").getByText(label)).toBeVisible();
}

test("opens from the main menu and from the command palette", async ({ page }) => {
  await openHistory(page);
  await page.getByTestId("version-history-close").click();
  await expect(page.getByTestId("version-history-panel")).toBeHidden();

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("command-palette-search").fill("version");
  await page.getByTestId("command-palette-item-toggle-version-history").click();
  await expect(page.getByTestId("version-history-panel")).toBeVisible();

  // Escape closes it, and the shortcut suppression means the key does not also reach the canvas.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("version-history-panel")).toBeHidden();
});

test("an empty history says so rather than showing a blank list", async ({ page }) => {
  await openHistory(page);

  await expect(page.getByTestId("version-history-empty")).toBeVisible();
});

test("a named version survives a reload and restores the board it described", async ({ page }) => {
  await drawRect(page, [300, 240], [420, 340]);
  await expect.poll(async () => (await autosavedElements(page)).length).toBe(1);

  await openHistory(page);
  await saveVersion(page, "one rectangle");
  await page.getByTestId("version-history-close").click();

  // Draw a second shape, so the restore has something to undo.
  await drawRect(page, [520, 240], [640, 340]);
  await expect.poll(async () => (await autosavedElements(page)).length).toBe(2);

  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await openHistory(page);
  const entry = page.getByTestId("version-history-list").getByText("one rectangle");
  await expect(entry).toBeVisible();

  page.on("dialog", (dialog) => void dialog.accept());
  const versions = await storedVersions(page);
  const named = versions.find((version) => version.label === "one rectangle")!;
  await page.getByTestId(`version-restore-${named.id}`).click();

  // Back to one rectangle, and the panel closed itself on success.
  await expect(page.getByTestId("version-history-panel")).toBeHidden();
  await expect.poll(async () => (await autosavedElements(page)).length).toBe(1);

  // …and the way back from the restore exists.
  await expect.poll(async () => (await storedVersions(page)).some((version) => version.label === "before-restore")).toBe(true);
});

test("restoring a version that contains an image shows the image", async ({ page }) => {
  await insertImage(page, RED_BLUE_PNG);
  await expect.poll(() => storedFileIds(page)).toHaveLength(1);

  await openHistory(page);
  await saveVersion(page, "with the photo");
  await page.getByTestId("version-history-close").click();

  // Delete the image from the board. Its bytes must survive, because the snapshot still names them.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await autosavedElements(page)).length).toBe(0);

  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await openHistory(page);
  const named = (await storedVersions(page)).find((version) => version.label === "with the photo")!;

  // The preview has to show the picture too — this is the screen whose entire job is recognising a
  // board by sight, and a snapshot's images are references, not payloads.
  await page.getByTestId(`version-preview-${named.id}`).click();
  await expect(page.getByTestId(`version-thumbnail-${named.id}`)).toBeVisible();

  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByTestId(`version-restore-${named.id}`).click();
  await expect(page.getByTestId("version-history-panel")).toBeHidden();

  // The pixels, not just the element: red on the left half, blue on the right.
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

test("deleting one entry and clearing all history both work from the panel", async ({ page }) => {
  await drawRect(page, [300, 240], [420, 340]);
  await openHistory(page);
  await saveVersion(page, "keep me");
  await saveVersion(page, "delete me");

  const doomed = (await storedVersions(page)).find((version) => version.label === "delete me")!;
  await page.getByTestId(`version-delete-${doomed.id}`).click();
  await expect(page.getByTestId(`version-entry-${doomed.id}`)).toBeHidden();
  await expect(page.getByTestId("version-history-list").getByText("keep me")).toBeVisible();

  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("version-history-clear").click();
  await expect(page.getByTestId("version-history-empty")).toBeVisible();
  await expect.poll(() => storedVersions(page)).toEqual([]);
});

test("restore is refused, with a reason on screen, while a room session is live", async ({ page }) => {
  await drawRect(page, [300, 240], [420, 340]);
  await openHistory(page);
  await saveVersion(page, "before the room");
  const named = (await storedVersions(page)).find((version) => version.label === "before the room")!;
  await expect(page.getByTestId(`version-restore-${named.id}`)).toBeEnabled();
  await page.getByTestId("version-history-close").click();

  // Hold `POST /room` open so the session sits in the *connecting* window — the state a guard that
  // only asked "are we connected?" would be blind to, and the one the 0.11.x data-loss bugs lived in.
  await page.route("**/room", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    await route.abort();
  });
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-collab").click();
  await page.getByTestId("collab-dialog-start").click();
  // Nothing has changed in the session's *rendered* state — the relay has not answered, so there is
  // no room link and the dialog still offers to start one. `status` is still "disconnected".
  await expect(page.getByTestId("collab-dialog-link")).toBeHidden();
  await page.keyboard.press("Escape");

  await openHistory(page);
  // …and yet restore is refused, because the guard reads the `joining` flag that was raised
  // synchronously before the connect was awaited. A guard that asked only "are we connected?" would
  // wave this straight through, replacing the document mid-join — the 0.11.1–0.11.3 bug shape.
  await expect(page.getByTestId("version-history-session-notice")).toBeVisible();
  await expect(page.getByTestId(`version-restore-${named.id}`)).toBeDisabled();
});
