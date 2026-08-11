import { test, expect } from "@playwright/test";

/**
 * Web embed (Excalidraw/tldraw parity): insert an allowlisted provider URL as an embed element.
 * Only allowlisted URLs are accepted (arbitrary iframes are refused). By default the embed shows a
 * static poster (no live iframe) so it stays movable/resizable/rotatable; the live iframe is mounted
 * only after the user activates it via the Interact toggle. Asserts the element + wiring, not that
 * external content loads.
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

test("inserting an embed adds a selected element and shows a static poster (no live iframe until activated)", async ({ page }) => {
  await insertYouTube(page);

  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();

  // Poster by default — the provider thumbnail, and NO live iframe.
  await expect(page.getByTestId("embed-preview")).toHaveAttribute("src", "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  await expect(page.getByTestId("embed-iframe")).toHaveCount(0);

  // Persists across reload (it's part of the scene document). Wait out the autosave debounce first.
  await page.waitForTimeout(1300);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect(page.getByTestId("embed-preview")).toHaveAttribute("src", "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
});

test("activating an embed mounts the sandboxed iframe with the provider embed URL, and Done returns to the poster", async ({ page }) => {
  await insertYouTube(page);

  await page.getByTestId("embed-interact-toggle").click(); // enter interact mode
  const iframe = page.getByTestId("embed-iframe");
  await expect(iframe).toHaveAttribute("src", "https://www.youtube.com/embed/dQw4w9WgXcQ");
  await expect(iframe).toHaveAttribute("sandbox", /allow-scripts/);
  await expect(iframe).toHaveCSS("pointer-events", "auto");
  await expect(page.getByTestId("embed-preview")).toHaveCount(0); // poster replaced by the live frame

  await page.getByTestId("embed-interact-toggle").click(); // Done → back to poster
  await expect(page.getByTestId("embed-iframe")).toHaveCount(0);
  await expect(page.getByTestId("embed-preview")).toBeVisible();
});

test("a selected embed is movable by dragging its poster (the poster doesn't steal the drag)", async ({ page }) => {
  await insertYouTube(page);
  await expect(page.getByTestId("embed-interact-toggle")).toBeVisible();

  const poster = page.getByTestId("embed-preview");
  await expect(poster).toHaveCSS("pointer-events", "none");
  const before = (await poster.boundingBox())!;
  const cx = before.x + before.width / 2;
  const cy = before.y + before.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 140, cy + 90);
  await page.mouse.up();

  const after = (await poster.boundingBox())!;
  expect(after.x - before.x).toBeGreaterThan(80); // it actually moved with the drag
});

test("a selected embed can be resized by its bottom-right handle, keeping its aspect ratio", async ({ page }) => {
  await insertYouTube(page);
  await expect(page.getByTestId("embed-interact-toggle")).toBeVisible();

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
