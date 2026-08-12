import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Layout contracts for the desktop chrome, asserted against real browser layout (the react package's
 * unit tests run in a `node` environment and cannot compute any of this).
 *
 * The defects these cover: the top-right properties panel is anchored to the top and grows with the
 * selection, so on a short-but-not-mobile viewport (the mobile chrome only takes over below 500px tall)
 * it ran off the bottom of the screen with its lower controls unreachable, and it painted over the
 * bottom-right minimap. Separately, a canvas-wide select-all dragged the browser's own text selection
 * across every chrome label.
 */

/** Short enough to overflow a tall panel, tall enough to stay on the desktop chrome (mobile is < 500px). */
const SHORT_DESKTOP = { width: 1280, height: 620 };

async function drawArrow(page: Page): Promise<void> {
  await page.getByTestId("toolbar-arrow-tool").click();
  await page.mouse.move(300, 250);
  await page.mouse.down();
  await page.mouse.move(500, 380);
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("the properties panel stays inside the viewport and scrolls instead of clipping its lower controls", async ({ page }) => {
  await page.setViewportSize(SHORT_DESKTOP);
  // An arrow selection is the tallest panel: shape rows plus the start/end arrowhead rows.
  await drawArrow(page);

  const panel = page.getByTestId("properties-panel");
  await expect(panel).toBeVisible();

  const box = (await panel.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(SHORT_DESKTOP.height);

  // Taller than the space available means it must scroll, not clip — the lower controls stay reachable.
  const { scrollHeight, clientHeight, overflowY } = await panel.evaluate((node) => ({
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
    overflowY: getComputedStyle(node).overflowY,
  }));
  expect(overflowY).toBe("auto");
  if (scrollHeight > clientHeight) {
    await panel.evaluate((node) => node.scrollTo(0, node.scrollHeight));
    expect(await panel.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  }
});

test("the properties panel never overlaps the minimap", async ({ page }) => {
  await page.setViewportSize(SHORT_DESKTOP);
  await drawArrow(page);

  const panelBox = (await page.getByTestId("properties-panel").boundingBox())!;
  const minimapBox = (await page.getByTestId("minimap").boundingBox())!;

  // Both are right-anchored, so they can only be separated vertically.
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(minimapBox.y);
});

test("the panel reclaims the minimap's space once the scene is empty and the minimap hides", async ({ page }) => {
  await page.setViewportSize(SHORT_DESKTOP);
  await drawArrow(page);

  // Compare the *cap*, not the rendered height: the panel's content changes with the selection, so a
  // rendered-height comparison would measure the row count rather than the space it is allowed.
  const capPx = async () => page.getByTestId("properties-panel").evaluate((node) => parseFloat(getComputedStyle(node).maxHeight));
  const withMinimap = await capPx();

  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("minimap")).toHaveCount(0);
  await page.getByTestId("toolbar-arrow-tool").click();

  const withoutMinimap = await capPx();
  expect(withoutMinimap).toBeGreaterThan(withMinimap);
  expect(withoutMinimap).toBeLessThanOrEqual(SHORT_DESKTOP.height);

  const box = (await page.getByTestId("properties-panel").boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(SHORT_DESKTOP.height);
});

test("select-all selects canvas elements without dragging a text selection across the chrome", async ({ page }) => {
  await drawArrow(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+a");

  const selectedChromeText = await page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return "";
    const root = document.querySelector('[data-testid="deviva-draw-root"]')!;
    return root.contains(selection.anchorNode) ? selection.toString().trim() : "";
  });
  expect(selectedChromeText).toBe("");
});

test("a text input inside the chrome can still be selected and copied from", async ({ page }) => {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-shortcuts").click();

  const search = page.getByTestId("shortcuts-dialog-search");
  await search.fill("rectangle");
  await search.selectText();

  expect(await search.evaluate((node: HTMLInputElement) => node.value.slice(node.selectionStart!, node.selectionEnd!))).toBe("rectangle");
});

test("the link popover is fully visible, not clipped by the properties panel's scroll container", async ({ page }) => {
  await page.setViewportSize(SHORT_DESKTOP);
  await drawArrow(page);

  await page.getByTestId("link-button").click();
  const popover = page.getByTestId("link-popover");
  await expect(popover).toBeVisible();

  // Portalled out of the panel: an in-flow child would be clipped, because the panel is a scroll
  // container (`overflow-y: auto` also computes `overflow-x: auto`) and the popover is wider than the
  // panel's content box.
  const panel = page.getByTestId("properties-panel");
  expect(await popover.evaluate((node, panelNode) => panelNode!.contains(node), await panel.elementHandle())).toBe(false);

  // ...but still inside the app root, whose CSS custom properties every chrome style resolves against.
  // Portalling to `document.body` puts it out of that scope, and the panel background silently resolves
  // to transparent — the popover then renders as controls floating over whatever is behind it.
  const { insideRoot, background } = await popover.evaluate((node) => ({
    insideRoot: Boolean(node.closest('[data-testid="deviva-draw-root"]')),
    background: getComputedStyle(node).backgroundColor,
  }));
  expect(insideRoot).toBe(true);
  expect(background).not.toMatch(/rgba?\([^)]*,\s*0\)$/); // opaque, not a transparent fallback

  // And fully on screen on every edge.
  const box = (await popover.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(SHORT_DESKTOP.width);
  expect(box.y + box.height).toBeLessThanOrEqual(SHORT_DESKTOP.height);

  // The input inside it is reachable and typable — the symptom was a cut-off, unusable field.
  await page.getByTestId("link-input").fill("https://example.com");
  await expect(page.getByTestId("link-input")).toHaveValue("https://example.com");
});
