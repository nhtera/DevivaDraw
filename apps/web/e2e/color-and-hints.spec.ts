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

test("the hint moves on from 'how to select' once something is selected", async ({ page }) => {
  const hint = page.getByTestId("canvas-hint");
  await expect(hint).toContainText(/drag to select/i);

  // Drawing hands back to the select tool with the new shape selected: the tool is the same, but the
  // useful sentence is no longer about starting a selection.
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(520, 400);
  await page.mouse.up();

  await expect(page.getByTestId("toolbar-select-tool")).toHaveAttribute("aria-pressed", "true");
  await expect(hint).toContainText(/resize/i);

  // Dropping the selection puts the original sentence back.
  await page.keyboard.press("Escape");
  await expect(hint).toContainText(/drag to select/i);
});

test("while typing, the hint says how to finish instead of how to start", async ({ page }) => {
  await page.mouse.dblclick(500, 380);
  await expect(page.getByTestId("text-editor-overlay-textarea")).toBeVisible();
  await expect(page.getByTestId("canvas-hint")).toContainText(/escape to finish/i);

  await page.getByTestId("text-editor-overlay-textarea").press("Escape");
  await expect(page.getByTestId("canvas-hint")).not.toContainText(/escape to finish/i);
});

test("a tool with no hint of its own shows no hint, rather than an empty line", async ({ page }) => {
  await page.getByTestId("toolbar-more").click();
  await page.getByTestId("more-laser-tool").click();
  await expect(page.getByTestId("canvas-hint")).toHaveCount(0);
});
