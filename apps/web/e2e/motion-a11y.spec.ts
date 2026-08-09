import { test, expect } from "@playwright/test";

/**
 * Phase 05: motion + accessibility. Chrome buttons animate (transition + press) only when motion is
 * allowed and collapse to static under prefers-reduced-motion; the active tool shows the soft-accent
 * background; keyboard focus produces a visible focus ring.
 */

test("chrome transitions are enabled when motion is allowed", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "no-preference" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  const duration = await page.getByTestId("toolbar-rectangle-tool").evaluate((node) => getComputedStyle(node).transitionDuration);
  expect(duration).not.toBe("0s");
  await context.close();
});

test("chrome is static under prefers-reduced-motion", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  const duration = await page.getByTestId("toolbar-rectangle-tool").evaluate((node) => getComputedStyle(node).transitionDuration);
  expect(duration === "0s" || duration === "").toBeTruthy();
  await context.close();
});

test("the active tool shows the soft-accent background, inactive tools are transparent", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  const active = await page.getByTestId("toolbar-select-tool").evaluate((node) => getComputedStyle(node).backgroundColor);
  const inactive = await page.getByTestId("toolbar-rectangle-tool").evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(active).not.toBe("rgba(0, 0, 0, 0)"); // tinted
  expect(inactive).toBe("rgba(0, 0, 0, 0)"); // transparent
});

test("keyboard focus produces a visible focus-visible outline on chrome buttons", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  const menu = page.getByTestId("top-bar-menu");
  await menu.focus();
  // Force the :focus-visible heuristic (keyboard-origin focus) then read the outline width.
  await page.keyboard.press("Tab");
  await menu.focus();
  const outlineWidth = await menu.evaluate((node) => {
    node.focus();
    return getComputedStyle(node).outlineWidth;
  });
  // The injected stylesheet sets a 2px outline on :focus-visible; programmatic focus after a key press
  // satisfies the heuristic in Chromium.
  expect(parseFloat(outlineWidth)).toBeGreaterThan(0);
});
