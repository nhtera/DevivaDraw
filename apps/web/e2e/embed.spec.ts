import { test, expect } from "@playwright/test";

/**
 * Web embed (Excalidraw/tldraw parity): insert an allowlisted provider URL as an embed element.
 * Only allowlisted URLs are accepted (arbitrary iframes are refused). By default the embed shows a
 * static poster with a play button (no live iframe) so it stays movable/resizable/rotatable; the live
 * iframe is mounted only after the user activates it (clicks play, or double-clicks). You leave by
 * clicking away or pressing Escape. Asserts the element + wiring, not that external content loads.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-embed").click();
  await expect(page.getByTestId("embed-dialog")).toBeVisible();
});

async function insertYouTube(page: import("@playwright/test").Page) {
  await page.getByTestId("embed-input").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByTestId("embed-insert").click();
  await expect(page.getByTestId("embed-dialog")).toHaveCount(0);
}

test("only allowlisted URLs enable the insert button", async ({ page }) => {
  await page.getByTestId("embed-input").fill("https://evil.example.com/page");
  await expect(page.getByTestId("embed-insert")).toBeDisabled();

  await page.getByTestId("embed-input").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await expect(page.getByTestId("embed-insert")).toBeEnabled();
});

test("inserting an embed shows a static poster with a play button (no live iframe until activated)", async ({ page }) => {
  await insertYouTube(page);

  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();

  // Poster + play button by default — the provider thumbnail, and NO live iframe.
  await expect(page.getByTestId("embed-preview")).toHaveAttribute("src", "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  await expect(page.getByTestId("embed-play")).toBeVisible();
  await expect(page.getByTestId("embed-iframe")).toHaveCount(0);

  // Persists across reload (it's part of the scene document). Wait out the autosave debounce first.
  await page.waitForTimeout(1300);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect(page.getByTestId("embed-preview")).toHaveAttribute("src", "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
});

test("clicking play mounts the sandboxed iframe; Escape returns to the poster", async ({ page }) => {
  await insertYouTube(page);

  await page.getByTestId("embed-play").click(); // activate
  const iframe = page.getByTestId("embed-iframe");
  await expect(iframe).toHaveAttribute("src", "https://www.youtube.com/embed/dQw4w9WgXcQ");
  await expect(iframe).toHaveAttribute("sandbox", /allow-scripts/);
  await expect(iframe).toHaveCSS("pointer-events", "auto");
  await expect(page.getByTestId("embed-preview")).toHaveCount(0); // poster replaced by the live frame

  await page.keyboard.press("Escape"); // leave interact mode → poster returns
  await expect(page.getByTestId("embed-iframe")).toHaveCount(0);
  await expect(page.getByTestId("embed-preview")).toBeVisible();
});

test("a selected embed is movable by dragging its poster (the poster doesn't steal the drag)", async ({ page }) => {
  await insertYouTube(page);
  await expect(page.getByTestId("embed-play")).toBeVisible();

  const poster = page.getByTestId("embed-preview");
  await expect(poster).toHaveCSS("pointer-events", "none");
  const before = (await poster.boundingBox())!;
  // Grab off-center so the drag starts on the poster body, not the centered play button.
  const gx = before.x + before.width * 0.22;
  const gy = before.y + before.height * 0.3;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + 140, gy + 90);
  await page.mouse.up();

  const after = (await poster.boundingBox())!;
  expect(after.x - before.x).toBeGreaterThan(80); // it actually moved with the drag
});

test("a selected embed can be resized by its bottom-right handle, keeping its aspect ratio", async ({ page }) => {
  await insertYouTube(page);
  await expect(page.getByTestId("embed-play")).toBeVisible();

  const poster = page.getByTestId("embed-preview");
  const before = (await poster.boundingBox())!;
  const beforeAspect = before.width / before.height;
  // The bottom-right resize handle sits at the element's bottom-right corner.
  const hx = before.x + before.width;
  const hy = before.y + before.height;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx + 160, hy + 120);
  await page.mouse.up();

  const after = (await poster.boundingBox())!;
  expect(after.width - before.width).toBeGreaterThan(100); // regression: embed used to be non-resizable
  expect(after.width / after.height).toBeCloseTo(beforeAspect, 1); // aspect locked — not distorted
});

test("double-clicking an embed activates it (and never drops a text element on top)", async ({ page }) => {
  await insertYouTube(page);
  const poster = page.getByTestId("embed-preview");
  const box = (await poster.boundingBox())!;
  // Double-click off-center so it lands on the poster body, not the play button.
  await page.mouse.dblclick(box.x + box.width * 0.7, box.y + box.height * 0.65);

  // Reaching activation proves the embed branch was taken: the dblclick handler returns there, so the
  // "empty canvas → new standalone text" branch (which would drop a text element + open its editor) is
  // never reached. No text editor is open, and the live frame is up.
  await expect(page.getByTestId("embed-iframe")).toHaveAttribute("src", "https://www.youtube.com/embed/dQw4w9WgXcQ");
});
