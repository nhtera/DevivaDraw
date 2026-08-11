import { test, expect } from "@playwright/test";

/**
 * Web embed (Excalidraw/tldraw parity): insert an allowlisted provider URL as a live embed element.
 * Only allowlisted URLs are accepted (arbitrary iframes are refused). Asserts the element + iframe
 * wiring, not that external content loads.
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

test("only allowlisted URLs enable the insert button", async ({ page }) => {
  await page.getByTestId("embed-input").fill("https://evil.example.com/page");
  await expect(page.getByTestId("embed-insert")).toBeDisabled();

  await page.getByTestId("embed-input").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await expect(page.getByTestId("embed-insert")).toBeEnabled();
});

test("inserting an embed adds a selected element and a sandboxed iframe with the provider embed URL", async ({ page }) => {
  await page.getByTestId("embed-input").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByTestId("embed-insert").click();

  await expect(page.getByTestId("embed-dialog")).toHaveCount(0);
  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();

  const iframe = page.getByTestId("embed-iframe");
  await expect(iframe).toHaveAttribute("src", "https://www.youtube.com/embed/dQw4w9WgXcQ");
  await expect(iframe).toHaveAttribute("sandbox", /allow-scripts/);

  // Persists across reload (it's part of the scene document). Wait out the autosave debounce first.
  await page.waitForTimeout(1300);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect(page.getByTestId("embed-iframe")).toHaveAttribute("src", "https://www.youtube.com/embed/dQw4w9WgXcQ");
});

test("a selected embed is movable by dragging its body (the iframe doesn't steal the drag)", async ({ page }) => {
  await page.getByTestId("embed-input").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByTestId("embed-insert").click();

  // Selected → click-through by default (movable) with an Interact toggle offered.
  await expect(page.getByTestId("embed-interact-toggle")).toBeVisible();
  await expect(page.getByTestId("embed-iframe")).toHaveCSS("pointer-events", "none");

  const iframe = page.getByTestId("embed-iframe");
  const before = (await iframe.boundingBox())!;
  const cx = before.x + before.width / 2;
  const cy = before.y + before.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 140, cy + 90);
  await page.mouse.up();

  const after = (await iframe.boundingBox())!;
  expect(after.x - before.x).toBeGreaterThan(80); // it actually moved with the drag
});

test("the Interact toggle switches the embed into live (pointer-capturing) mode and back", async ({ page }) => {
  await page.getByTestId("embed-input").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByTestId("embed-insert").click();

  const toggle = page.getByTestId("embed-interact-toggle");
  await expect(page.getByTestId("embed-iframe")).toHaveCSS("pointer-events", "none");

  await toggle.click(); // enter interact mode → iframe takes pointer events
  await expect(toggle).toHaveText("Done");
  await expect(page.getByTestId("embed-iframe")).toHaveCSS("pointer-events", "auto");

  await toggle.click(); // back to movable
  await expect(page.getByTestId("embed-iframe")).toHaveCSS("pointer-events", "none");
});
