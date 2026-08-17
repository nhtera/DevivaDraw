import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Input-device preference (main menu → Preferences): Auto / Trackpad / Mouse radio, the
 * mouse-only "Invert mouse zoom" row, and the "Pen draws, finger pans" toggle — plus the wheel
 * routing each mode actually produces (mouse mode turns plain scroll into zoom-at-cursor; trackpad
 * mode keeps scroll-to-pan even for mouse-notch deltas).
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function openInputDeviceSection(page: Page): Promise<void> {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-preferences").click();
  await expect(page.getByTestId("main-menu-preferences-flyout")).toBeVisible();
}

async function closeMenu(page: Page): Promise<void> {
  await page.keyboard.press("Escape"); // flyout
  await page.keyboard.press("Escape"); // menu
  await expect(page.getByTestId("main-menu")).toHaveCount(0);
}

/** Fires a wheel event at the canvas with full control over the delta shape (integer = mouse notch, fractional = trackpad). */
async function wheelOnCanvas(page: Page, deltaY: number): Promise<void> {
  await page.evaluate((delta) => {
    const canvas = document.querySelector('[data-testid="deviva-draw-canvas-host"] canvas')!;
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, clientX: 500, clientY: 300, bubbles: true, cancelable: true }));
  }, deltaY);
}

const zoomReadout = (page: Page) => page.getByTestId("top-bar-zoom-percentage");

test("defaults to Auto with the invert row disabled until Mouse is picked", async ({ page }) => {
  await openInputDeviceSection(page);
  await expect(page.getByTestId("main-menu-input-device-auto")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("main-menu-invert-mouse-zoom")).toBeDisabled();

  await page.getByTestId("main-menu-input-device-mouse").click();
  await expect(page.getByTestId("main-menu-input-device-mouse")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("main-menu-input-device-auto")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("main-menu-invert-mouse-zoom")).toBeEnabled();

  await page.getByTestId("main-menu-invert-mouse-zoom").click();
  await expect(page.getByTestId("main-menu-invert-mouse-zoom")).toHaveAttribute("aria-checked", "true");
});

test("the whole preference survives a reload", async ({ page }) => {
  await openInputDeviceSection(page);
  await page.getByTestId("main-menu-input-device-mouse").click();
  await page.getByTestId("main-menu-invert-mouse-zoom").click();
  await page.getByTestId("main-menu-pen-only-draw").click();
  await expect(page.getByTestId("main-menu-pen-only-draw")).toHaveAttribute("aria-checked", "true");

  await page.reload();
  await openInputDeviceSection(page);
  await expect(page.getByTestId("main-menu-input-device-mouse")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("main-menu-invert-mouse-zoom")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("main-menu-pen-only-draw")).toHaveAttribute("aria-checked", "true");
});

test("mouse mode zooms on plain wheel; trackpad mode keeps panning even on notch deltas", async ({ page }) => {
  await expect(zoomReadout(page)).toHaveText("100%");

  // Default Auto: a fractional (trackpad-signature) delta pans — zoom untouched.
  await wheelOnCanvas(page, 60.5);
  await expect(zoomReadout(page)).toHaveText("100%");

  // Trackpad mode: even a mouse-notch 120 delta pans.
  await openInputDeviceSection(page);
  await page.getByTestId("main-menu-input-device-trackpad").click();
  await closeMenu(page);
  await wheelOnCanvas(page, 120);
  await expect(zoomReadout(page)).toHaveText("100%");

  // Mouse mode: a plain fractional delta now zooms at the cursor — no rebuild, applied live.
  await openInputDeviceSection(page);
  await page.getByTestId("main-menu-input-device-mouse").click();
  await closeMenu(page);
  await wheelOnCanvas(page, -60.5);
  await expect(zoomReadout(page)).not.toHaveText("100%");
});
