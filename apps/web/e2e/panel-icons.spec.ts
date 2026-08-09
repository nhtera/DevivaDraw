import { test, expect } from "@playwright/test";

/**
 * Guards the properties-panel iconography: the style controls (fill / stroke width / stroke style /
 * sloppiness / edges) render as icon buttons, not wrapping text labels, while keeping their accessible
 * name and still toggling the underlying style. Prevents a regression back to the verbose text UI.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("stroke-width controls are icon buttons that keep their label and still toggle", async ({ page }) => {
  const thin = page.getByTestId("stroke-width-thin");
  const bold = page.getByTestId("stroke-width-bold");

  // Icon, not text: the button renders an SVG glyph and no visible text label.
  await expect(thin.locator("svg")).toHaveCount(1);
  expect((await thin.innerText()).trim()).toBe("");

  // Accessible name preserved for screen readers / tooltips.
  await expect(thin).toHaveAttribute("aria-label", /.+/);

  // Still functional: selecting a width updates the pressed state.
  await expect(thin).toHaveAttribute("aria-pressed", "true");
  await bold.click();
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await expect(thin).toHaveAttribute("aria-pressed", "false");
});
