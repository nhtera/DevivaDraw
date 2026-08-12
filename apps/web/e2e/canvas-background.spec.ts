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

test("the color popover paints above the menu that opened it, and its swatches are clickable", async ({ page }) => {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("canvas-background-more").click();
  const popover = page.getByTestId("canvas-background-popover");
  await expect(popover).toBeVisible();

  // The popover is portalled to the app root and positioned over the menu, so it needs a higher stacking
  // layer than the menu — with a lower one it opened *underneath*, showing the menu's own rows through
  // where its swatches should be. Nothing above catches this: a `fill()`/`click()` on a covered control
  // still reaches it through the DOM, so the assertion has to be about what is actually painted on top.
  const covered = await popover.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const topmost = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return !node.contains(topmost);
  });
  expect(covered).toBe(false);

  // And a real mouse click on a swatch lands on the swatch — not on the menu row behind it.
  const swatch = popover.locator("button").nth(1); // first palette entry after the theme default
  const box = (await swatch.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => hostBackground(page)).toBe("rgb(248, 249, 250)");
});

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
