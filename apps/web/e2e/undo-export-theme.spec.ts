import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function drawRectangle(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(480, 420);
  await page.mouse.up();
}

test("exporting to PNG triggers a real file download", async ({ page }) => {
  await drawRectangle(page);

  await page.getByTestId("top-bar-menu").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("main-menu-export-png").click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.png$/);
});

test("exporting to SVG triggers a real file download", async ({ page }) => {
  await drawRectangle(page);

  await page.getByTestId("top-bar-menu").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("main-menu-export-svg").click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.svg$/);
});

test("theme toggle switches the canvas background CSS variable between light and dark", async ({ page }) => {
  const readCanvasBackground = () =>
    page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="deviva-draw-root"]')!).getPropertyValue("--dd-canvas-background").trim());

  const lightBackground = await readCanvasBackground();

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-theme-dark").click();

  const darkBackground = await readCanvasBackground();
  expect(darkBackground).not.toBe(lightBackground);

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-theme-light").click();

  const backToLight = await readCanvasBackground();
  expect(backToLight).toBe(lightBackground);
});
