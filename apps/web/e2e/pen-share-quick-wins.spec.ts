import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Phase-03 quick wins: the constant-width pen preference, and the QR code in the share dialog.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function openPreferencesFlyout(page: Page): Promise<void> {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-preferences").click();
  await expect(page.getByTestId("main-menu-preferences-flyout")).toBeVisible();
}

async function closeMenu(page: Page): Promise<void> {
  await page.keyboard.press("Escape"); // flyout
  await page.keyboard.press("Escape"); // menu
  await expect(page.getByTestId("main-menu")).toHaveCount(0);
}

interface StoredFreedraw {
  points: [number, number, number][];
  simulatePressure: boolean;
}

/** The autosaved freehand stroke (waits out the autosave debounce). */
async function storedFreedraw(page: Page): Promise<StoredFreedraw> {
  await page.waitForTimeout(1300);
  const element = await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!);
    const scene = doc.pages ? doc.pages[0].scene : doc;
    return scene.elements.find((el: { type: string; isDeleted: boolean }) => el.type === "freedraw" && !el.isDeleted) ?? null;
  });
  expect(element, "expected a freedraw element in the autosaved document").not.toBeNull();
  return element as StoredFreedraw;
}

/** Draws a freehand stroke well clear of the left-edge properties panel. */
async function drawStroke(page: Page): Promise<void> {
  await page.getByTestId("toolbar-freedraw-tool").click();
  await page.mouse.move(600, 300);
  await page.mouse.down();
  for (const x of [640, 680, 720, 760, 800]) await page.mouse.move(x, 300 + (x % 80));
  await page.mouse.up();
}

test("constant-width pen: off by default, so pressure and the simulation flag behave as before", async ({ page }) => {
  await drawStroke(page);

  const stroke = await storedFreedraw(page);
  // A mouse gesture reports no real pressure, so the renderer simulates it from velocity — the
  // behavior the preference exists to switch off.
  expect(stroke.simulatePressure).toBe(true);
});

test("constant-width pen: on pins every sample to one pressure and turns velocity simulation off", async ({ page }) => {
  await openPreferencesFlyout(page);
  await page.getByTestId("main-menu-constant-width-pen").click();
  await expect(page.getByTestId("main-menu-constant-width-pen")).toHaveAttribute("aria-checked", "true");
  await closeMenu(page);

  await drawStroke(page);

  const stroke = await storedFreedraw(page);
  expect(stroke.simulatePressure).toBe(false);
  const pressures = stroke.points.map((point) => point[2]);
  expect(pressures.length).toBeGreaterThan(2);
  expect(new Set(pressures).size).toBe(1); // one uniform value across every sample
});

test("constant-width pen persists across a reload", async ({ page }) => {
  await openPreferencesFlyout(page);
  await page.getByTestId("main-menu-constant-width-pen").click();
  await closeMenu(page);

  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  await openPreferencesFlyout(page);
  await expect(page.getByTestId("main-menu-constant-width-pen")).toHaveAttribute("aria-checked", "true");
});

test("the share dialog shows a QR code for the generated link", async ({ page }) => {
  // The collab-server is intercepted rather than run — the dialog only needs a minted URL, and the
  // QR is produced entirely client-side (see `browser/qr-code.ts` on why it must be).
  await page.route("**/blobs/**", async (route) => route.fulfill({ status: 204 }));

  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(600, 250);
  await page.mouse.down();
  await page.mouse.move(760, 360);
  await page.mouse.up();

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-share").click();
  await expect(page.getByTestId("share-qr")).toHaveCount(0); // nothing minted yet, nothing to encode

  await page.getByTestId("share-dialog-regenerate").click();
  await expect(page.getByTestId("share-dialog-link")).toBeVisible();

  const qr = page.getByTestId("share-qr");
  await expect(qr).toBeVisible();

  // A real symbol, not an empty frame: a square viewBox of at least the smallest QR size plus its
  // quiet zone, and a path carrying many dark modules.
  const viewBox = (await qr.getAttribute("viewBox"))!.split(" ").map(Number);
  expect(viewBox[2]).toBe(viewBox[3]);
  expect(viewBox[2]).toBeGreaterThanOrEqual(21 + 8);
  const moduleCount = ((await qr.locator("path").getAttribute("d")) ?? "").match(/h1v1h-1z/g)?.length ?? 0;
  expect(moduleCount).toBeGreaterThan(50);
});

test("the QR tracks the current link — regenerating a new URL redraws it", async ({ page }) => {
  await page.route("**/blobs/**", async (route) => route.fulfill({ status: 204 }));

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-share").click();
  await page.getByTestId("share-dialog-regenerate").click();

  const qrPath = () => page.getByTestId("share-qr").locator("path").getAttribute("d");
  const firstUrl = await page.getByTestId("share-dialog-link").inputValue();
  const firstPath = await qrPath();

  // Regenerating mints a fresh key, so the URL changes; the code must change with it.
  // (That the path is the *correct* encoding of a given URL is pinned module-for-module against the
  // encoder itself in `qr-code.test.ts` — this only has to prove the dialog feeds it the live URL.)
  await page.getByTestId("share-dialog-regenerate").click();
  await expect.poll(async () => page.getByTestId("share-dialog-link").inputValue()).not.toBe(firstUrl);

  await expect.poll(qrPath).not.toBe(firstPath);
});
