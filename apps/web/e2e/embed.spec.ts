import { test, expect } from "@playwright/test";

/**
 * Web embed — Excalidraw model. Only allowlisted provider URLs are accepted (arbitrary iframes are
 * refused). The live iframe is always mounted but click-through (`pointer-events: none`) until you
 * activate it, so the embed selects/moves/resizes/rotates freely; a "Click to interact" overlay is the
 * affordance. Activate by clicking the already-selected embed (or double-clicking); leave with Escape
 * or by clicking away. Resize is free (any ratio). Asserts the wiring, not that external content loads.
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

test("inserting shows the live iframe (click-through) with a Click-to-interact overlay, and persists", async ({ page }) => {
  await insertYouTube(page);

  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
  const iframe = page.getByTestId("embed-iframe");
  await expect(iframe).toHaveAttribute("src", "https://www.youtube.com/embed/dQw4w9WgXcQ");
  await expect(iframe).toHaveAttribute("sandbox", /allow-scripts/);
  await expect(iframe).toHaveCSS("pointer-events", "none"); // click-through until activated
  await expect(page.getByTestId("embed-interact-overlay")).toBeVisible();

  // Persists across reload (it's part of the scene document). Wait out the autosave debounce first.
  await page.waitForTimeout(1300);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect(page.getByTestId("embed-iframe")).toHaveAttribute("src", "https://www.youtube.com/embed/dQw4w9WgXcQ");
});

test("clicking the selected embed activates it; Escape deactivates", async ({ page }) => {
  await insertYouTube(page);
  const iframe = page.getByTestId("embed-iframe");
  const box = (await iframe.boundingBox())!;

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // tap the already-selected embed
  await expect(iframe).toHaveCSS("pointer-events", "auto");
  await expect(iframe).toHaveAttribute("src", "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1"); // plays on this one click
  await expect(page.getByTestId("embed-interact-overlay")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("embed-iframe")).toHaveCSS("pointer-events", "none");
  await expect(page.getByTestId("embed-iframe")).toHaveAttribute("src", "https://www.youtube.com/embed/dQw4w9WgXcQ"); // back to the plain poster
});

test("a selected embed is movable by dragging (the iframe is click-through, so the drag reaches the canvas)", async ({ page }) => {
  await insertYouTube(page);
  const iframe = page.getByTestId("embed-iframe");
  await expect(iframe).toHaveCSS("pointer-events", "none");

  const before = (await iframe.boundingBox())!;
  const cx = before.x + before.width / 2;
  const cy = before.y + before.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 140, cy + 90);
  await page.mouse.up();

  const after = (await iframe.boundingBox())!;
  expect(after.x - before.x).toBeGreaterThan(80); // moved with the drag, didn't activate
});

test("a selected embed resizes at any ratio (free — not aspect-locked)", async ({ page }) => {
  await insertYouTube(page);
  const iframe = page.getByTestId("embed-iframe");
  const before = (await iframe.boundingBox())!;
  // Drag the bottom-right handle horizontally only: width grows, height stays — proves free resize.
  // Handles ride the padded selection frame, not the element's own corner (engine
  // `selection/resize-handles.ts`, `SELECTION_PADDING_PX`), so aim where the handle is actually drawn —
  // the raw corner now reads as "inside the selection" and starts a move instead.
  const SELECTION_PADDING_PX = 6;
  const hx = before.x + before.width + SELECTION_PADDING_PX;
  const hy = before.y + before.height + SELECTION_PADDING_PX;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx + 200, hy);
  await page.mouse.up();

  const after = (await iframe.boundingBox())!;
  expect(after.width - before.width).toBeGreaterThan(150);
  expect(Math.abs(after.height - before.height)).toBeLessThan(30); // height unchanged → not locked to 16:9
});

test("double-clicking an embed activates it (and never drops a text element on top)", async ({ page }) => {
  await insertYouTube(page);
  const iframe = page.getByTestId("embed-iframe");
  const box = (await iframe.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width * 0.7, box.y + box.height * 0.6);

  // Reaching activation proves the embed branch was taken: the dblclick handler returns there, so the
  // "empty canvas → new standalone text" branch (which would drop a text element) is never reached.
  await expect(iframe).toHaveCSS("pointer-events", "auto");
});
