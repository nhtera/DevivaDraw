import { test, expect } from "@playwright/test";

/**
 * Export dialog (Excalidraw parity): scale + background options, and PNG / SVG / PDF export.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  // Draw something so there's content to export.
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(320, 300);
  await page.mouse.down();
  await page.mouse.move(500, 440);
  await page.mouse.up();
  await page.keyboard.press("Escape");

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-export-image").click();
  await expect(page.getByTestId("export-dialog")).toBeVisible();
});

test("the export dialog exports PNG at the chosen scale", async ({ page }) => {
  await page.getByTestId("export-scale-3").click();
  await expect(page.getByTestId("export-scale-3")).toHaveAttribute("aria-checked", "true");

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-png").click()]);
  expect(download.suggestedFilename()).toBe("scene-3x.png");
});

test("the export dialog exports SVG", async ({ page }) => {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-svg").click()]);
  expect(download.suggestedFilename()).toBe("scene.svg");
});

test("the export dialog exports PDF (jsPDF, dynamically imported)", async ({ page }) => {
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByTestId("export-pdf").click()]);
  expect(download.suggestedFilename()).toBe("scene.pdf");
});

test("the export dialog offers a background toggle and closes on overlay click", async ({ page }) => {
  await expect(page.getByTestId("export-include-background")).toBeChecked();
  await page.getByTestId("export-include-background").uncheck();
  await expect(page.getByTestId("export-include-background")).not.toBeChecked();

  await page.getByTestId("export-dialog-overlay").click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId("export-dialog")).toHaveCount(0);
});
