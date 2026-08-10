import { test, expect } from "@playwright/test";

/**
 * Per-scene canvas background color (Excalidraw parity): set from the main menu, applied to the live
 * canvas surface, and persisted across reload via autosave (it rides the scene document).
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function hostBackground(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="deviva-draw-canvas-host"]')!).backgroundColor);
}

test("setting a canvas background from the menu recolors the canvas and survives reload", async ({ page }) => {
  // Default: the light theme's white canvas.
  expect(await hostBackground(page)).toBe("rgb(255, 255, 255)");

  // Open the menu and set a soft yellow background via the canvas-background picker's hex input.
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("canvas-background-more").click();
  await expect(page.getByTestId("canvas-background-popover")).toBeVisible();
  await page.getByTestId("canvas-background-hex").fill("#fff9db");
  await page.getByTestId("canvas-background-hex").press("Enter");

  await expect.poll(() => hostBackground(page)).toBe("rgb(255, 249, 219)");

  // Give autosave its debounce window, then reload — the background is restored from the scene doc.
  await page.waitForTimeout(1300);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect.poll(() => hostBackground(page)).toBe("rgb(255, 249, 219)");
});
