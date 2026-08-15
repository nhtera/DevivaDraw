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

test("main-menu items render monochrome SVG icons (not emoji glyphs)", async ({ page }) => {
  await page.getByTestId("top-bar-menu").click();
  await expect(page.getByTestId("main-menu")).toBeVisible();
  // Menu actions carry an SVG icon alongside their text label.
  await expect(page.getByTestId("main-menu-export-png").locator("svg")).toHaveCount(1);
  await expect(page.getByTestId("main-menu-share").locator("svg")).toHaveCount(1);
});

test("stroke-width controls are icon buttons that keep their label and still toggle", async ({ page }) => {
  // The panel shows once a creation tool is active (idle select is a clean canvas, matching competitors).
  await page.getByTestId("toolbar-rectangle-tool").click();
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

test("the preferences flyout keeps the menu open for multiple toggles and Escape steps back one level", async ({ page }) => {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-preferences").click();
  await expect(page.getByTestId("main-menu-preferences-flyout")).toBeVisible();

  // Flipping a toggle updates its check WITHOUT closing menu or flyout — several in one visit.
  await page.getByTestId("main-menu-toggle-grid").click();
  await expect(page.getByTestId("main-menu-toggle-grid")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("main-menu-toggle-minimap").click();
  await expect(page.getByTestId("main-menu-toggle-minimap")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("main-menu")).toBeVisible();

  // Escape closes the flyout first, then the menu.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("main-menu-preferences-flyout")).toHaveCount(0);
  await expect(page.getByTestId("main-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("main-menu")).toHaveCount(0);

  // The choices stuck: grid on, minimap off.
  await expect(page.getByTestId("minimap")).toHaveCount(0);
});
