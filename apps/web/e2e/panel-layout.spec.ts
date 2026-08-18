import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Layout contracts for the desktop chrome, asserted against real browser layout (the react package's
 * unit tests run in a `node` environment and cannot compute any of this).
 *
 * The defects these cover: the properties panel is anchored to the top and grows with the selection,
 * so on a short-but-not-mobile viewport (the mobile chrome only takes over below 500px tall) it ran
 * off the bottom of the screen with its lower controls unreachable, and it painted over neighbouring
 * chrome. Separately, a canvas-wide select-all dragged the browser's own text selection across every
 * chrome label.
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

/** Every descendant of `testId` whose box sticks out past its content box, as `tag[testid]` labels. */
async function overflowingChildren(page: Page, testId: string): Promise<string[]> {
  return page.evaluate((id) => {
    const container = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
    const style = getComputedStyle(container);
    const right = container.getBoundingClientRect().right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
    const left = container.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const out: string[] = [];
    for (const node of container.querySelectorAll("*")) {
      const element = node as HTMLElement;
      if (getComputedStyle(element).position === "fixed") continue; // portalled popovers are positioned in the viewport
      const box = element.getBoundingClientRect();
      if (box.width === 0) continue;
      if (box.right > right + 0.5 || box.left < left - 0.5) out.push(`${element.tagName}[${element.dataset.testid ?? ""}] ${Math.round(box.left)}..${Math.round(box.right)} vs ${Math.round(left)}..${Math.round(right)}`);
    }
    return out;
  }, testId);
}

test("the properties panel never scrolls sideways, whatever is selected", async ({ page }) => {
  await page.setViewportSize(SHORT_DESKTOP);
  // An arrow is the widest panel as well as the tallest: the shape rows, both arrowhead rows, and the
  // full layer grid (z-order, align, distribute, group) all render at once.
  await drawArrow(page);
  const panel = page.getByTestId("properties-panel");
  await expect(panel).toBeVisible();

  // The six align buttons used to be a fixed-width row a few pixels wider than the panel's content
  // box, and the opacity slider added a UA margin on top of its `width: 100%`. Either one alone was
  // enough for a horizontal scrollbar, because a scroll container computes `overflow-x` next to its
  // `overflow-y` — so the panel offered a sideways scroll with nothing meaningful to reveal.
  expect(await overflowingChildren(page, "properties-panel")).toEqual([]);
  expect(await panel.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(0);

  // ...and it must not merely be clipping the overflow away, which would hide the controls instead.
  expect(await panel.evaluate((node) => getComputedStyle(node).overflowX)).not.toBe("hidden");

  // The text panel is a different set of rows (font family, size, align) over the same layer grid.
  await page.keyboard.press("Escape");
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(800, 250);
  await page.keyboard.type("hello");
  await expect(page.getByTestId("properties-panel-text")).toBeVisible();
  expect(await overflowingChildren(page, "properties-panel-text")).toEqual([]);
});

test("the properties panel is docked under the top bar on the left edge, clear of both", async ({ page }) => {
  await page.setViewportSize(SHORT_DESKTOP);
  await drawArrow(page);

  const panelBox = (await page.getByTestId("properties-panel").boundingBox())!;
  const topBarBox = (await page.getByTestId("top-bar").boundingBox())!;

  // Same edge, stacked — so the panel's own inset is measured against the bar's real rendered height
  // rather than a constant that can drift away from it.
  expect(panelBox.x).toBe(topBarBox.x);
  expect(panelBox.y).toBeGreaterThanOrEqual(topBarBox.y + topBarBox.height);
  expect(panelBox.x).toBeLessThan(SHORT_DESKTOP.width / 2);
});

test("the properties panel never overlaps the minimap", async ({ page }) => {
  await page.setViewportSize(SHORT_DESKTOP);
  await drawArrow(page);

  const panelBox = (await page.getByTestId("properties-panel").boundingBox())!;
  const minimapBox = (await page.getByTestId("minimap").boundingBox())!;

  // Opposite corners now (panel top-left, minimap bottom-right), so separation on *either* axis is
  // enough — which is why the panel no longer has to cap its height against the minimap's.
  const overlaps =
    panelBox.x < minimapBox.x + minimapBox.width &&
    minimapBox.x < panelBox.x + panelBox.width &&
    panelBox.y < minimapBox.y + minimapBox.height &&
    minimapBox.y < panelBox.y + panelBox.height;
  expect(overlaps).toBe(false);
});

test("the properties panel keeps its distance from the library sidebar, which owns the other edge", async ({ page }) => {
  await page.setViewportSize(SHORT_DESKTOP);
  await drawArrow(page);
  await page.getByTestId("library-toggle").click();
  await expect(page.getByTestId("library-panel")).toBeVisible();

  // The whole point of moving the panel off the right edge: opening the sidebar no longer displaces it.
  const panelBox = (await page.getByTestId("properties-panel").boundingBox())!;
  const sidebarBox = (await page.getByTestId("library-panel").boundingBox())!;
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(sidebarBox.x);
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

/**
 * The chrome's font, asserted across every rendered element rather than one component at a time: the
 * host page ships no global font rule (this app's `index.html` has no stylesheet at all), so anything
 * that inherits from the document — a floating pill that is itself the panel, an unstyled `<button>`,
 * a `<select>` taking its UA font — falls back to the browser's default serif and reads as a stray
 * document paragraph rather than UI. The exit-zen pill did exactly that.
 */
test("every chrome surface renders in the chrome font, never the browser's default serif", async ({ page }) => {
  await drawArrow(page);
  await page.getByTestId("top-bar-menu").click();
  await expect(page.getByTestId("main-menu")).toBeVisible();

  const strayFonts = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="deviva-draw-root"]')!;
    const out: string[] = [];
    for (const node of root.querySelectorAll("*")) {
      const font = getComputedStyle(node as HTMLElement).fontFamily;
      // Deliberate faces are named stacks; only an unset one lands on a bare UA serif.
      if (!/sans-serif|monospace/i.test(font)) out.push(`${node.tagName}[${(node as HTMLElement).dataset.testid ?? ""}] ${font}`);
    }
    return out;
  });
  expect(strayFonts).toEqual([]);

  // Same again for the one surface that survives zen, which is where the defect showed.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+z");
  const pill = page.getByTestId("exit-zen-pill");
  await expect(pill).toBeVisible();
  expect(await pill.evaluate((node) => getComputedStyle(node).fontFamily)).toMatch(/sans-serif/);
});
