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
