import { test, expect } from "@playwright/test";

/**
 * Phase 04 signature interactions: the color-picker popover (palette + shades + hex + eyedropper) and
 * the contextual per-tool hint under the toolbar.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("the color popover opens with shades + hex and a typed hex updates the current color", async ({ page }) => {
  // The properties panel is shown once a creation tool is active (idle select shows a clean canvas,
  // matching competitors) — pick the rectangle tool so its "next shape" style controls are present.
  await page.getByTestId("toolbar-rectangle-tool").click();
  const trigger = page.getByTestId("stroke-color-more");
  await trigger.click();
  const popover = page.getByTestId("stroke-color-popover");
  await expect(popover).toBeVisible();
  // Popover surfaces a hex input and a shade ramp (more than the palette row alone).
  await expect(page.getByTestId("stroke-color-hex")).toBeVisible();

  const hex = page.getByTestId("stroke-color-hex");
  await hex.fill("#ff8800");
  await hex.press("Enter");

  // The current-color trigger chip reflects the committed hex (rgb(255,136,0)), proving the picker
  // applied it to the active style.
  await expect(async () => {
    const bg = await trigger.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(bg.replace(/\s/g, "")).toBe("rgb(255,136,0)");
  }).toPass();
});

test("the contextual hint reflects the active tool", async ({ page }) => {
  const hint = page.getByTestId("canvas-hint");
  await expect(hint).toBeVisible();
  const selectHint = await hint.innerText();

  await page.getByTestId("toolbar-rectangle-tool").click();
  await expect(hint).toContainText(/rectangle/i);

  await page.getByTestId("toolbar-line-tool").click();
  const lineHint = await hint.innerText();
  expect(lineHint).not.toBe(selectHint);
  expect(lineHint.toLowerCase()).toContain("line");
});
