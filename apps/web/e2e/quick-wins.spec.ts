import { test, expect } from "@playwright/test";

/**
 * Phase-01 "quick wins" parity features: bucket fill, copy/paste styles, element hyperlinks, and
 * find-on-canvas. Each mirrors the corresponding Excalidraw affordance.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

/** Counts light-blue fill pixels (blue clearly dominant) in a region of the committed (static) layer. */
async function bluePixels(page: import("@playwright/test").Page, x: number, y: number, w: number, h: number): Promise<number> {
  return page.evaluate(
    ({ x, y, w, h }) => {
      const canvases = [...document.querySelectorAll("canvas")];
      const cv = canvases[canvases.length - 2]!; // static layer holds committed elements
      const ctx = cv.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;
      const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), Math.round(w * dpr), Math.round(h * dpr)).data;
      let blue = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3]! > 120 && d[i + 2]! > 180 && d[i + 2]! - d[i]! > 30 && d[i + 2]! - d[i + 1]! > 20) blue++;
      }
      return blue;
    },
    { x, y, w, h },
  );
}

async function setBackgroundHex(page: import("@playwright/test").Page, hex: string): Promise<void> {
  await page.getByTestId("background-color-more").click();
  await expect(page.getByTestId("background-color-popover")).toBeVisible();
  const input = page.getByTestId("background-color-hex");
  await input.fill(hex);
  await input.press("Enter");
}

test("bucket fill paints a clicked shape's interior with the current fill color", async ({ page }) => {
  // Draw a rectangle (transparent), then deselect it.
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(320, 300);
  await page.mouse.down();
  await page.mouse.move(520, 460);
  await page.mouse.up();
  await page.keyboard.press("Escape");
  expect(await bluePixels(page, 340, 320, 160, 120)).toBeLessThan(20); // no fill yet

  // Pick the bucket tool from the More menu; its shortcut also selects it.
  await page.getByTestId("toolbar-more").click();
  await page.getByTestId("more-bucket-fill-tool").click();
  await expect(page.getByTestId("toolbar-more")).toBeVisible();

  // With bucket active (nothing selected) the panel shows the "next fill" default — set it to blue.
  await setBackgroundHex(page, "#4dabf7");

  // Click inside the rectangle → it fills.
  await page.mouse.click(420, 380);
  await expect.poll(() => bluePixels(page, 340, 320, 160, 120)).toBeGreaterThan(200);
});

test("bucket fill has a 'b' keyboard shortcut", async ({ page }) => {
  await page.keyboard.press("b");
  await page.getByTestId("toolbar-more").click();
  await expect(page.getByTestId("more-bucket-fill-tool")).toHaveAttribute("aria-pressed", "true");
});

test("copy styles from one element pastes onto another (Ctrl+Alt+C / Ctrl+Alt+V)", async ({ page }) => {
  // Rect A (left) and Rect B (right), both transparent.
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(420, 420);
  await page.mouse.up();
  await page.keyboard.press("Escape");

  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(560, 300);
  await page.mouse.down();
  await page.mouse.move(680, 420);
  await page.mouse.up();
  await page.keyboard.press("Escape");

  // Fill A blue by selecting it (marquee around it — robust vs a thin unfilled stroke) and setting bg.
  const marquee = async (x1: number, y1: number, x2: number, y2: number) => {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2);
    await page.mouse.up();
  };
  await marquee(270, 270, 440, 440); // encloses A only
  await expect(page.getByTestId("properties-panel")).toBeVisible();
  await setBackgroundHex(page, "#4dabf7");
  expect(await bluePixels(page, 315, 315, 90, 90)).toBeGreaterThan(150); // A is blue
  expect(await bluePixels(page, 575, 315, 90, 90)).toBeLessThan(20); // B still transparent

  // Copy A's styles, select B (marquee around it), paste.
  await page.keyboard.press("Control+Alt+c");
  await page.keyboard.press("Escape");
  await marquee(540, 270, 700, 440); // encloses B only
  await expect(page.getByTestId("properties-panel")).toBeVisible();
  await page.keyboard.press("Control+Alt+v");

  await expect.poll(() => bluePixels(page, 575, 315, 90, 90)).toBeGreaterThan(150); // B inherited A's fill
});

test("an element hyperlink can be added and read back", async ({ page }) => {
  // Draw a rectangle (auto-selected → the panel's link control is available).
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(340, 320);
  await page.mouse.down();
  await page.mouse.move(500, 440);
  await page.mouse.up();

  await page.getByTestId("link-button").click();
  await expect(page.getByTestId("link-popover")).toBeVisible();
  await page.getByTestId("link-input").fill("example.com");
  await page.getByTestId("link-input").press("Enter");

  // Reopen → the saved link is normalized to https and persisted on the element.
  await page.getByTestId("link-button").click();
  await expect(page.getByTestId("link-input")).toHaveValue("https://example.com/");
});

test("find-on-canvas (Cmd/Ctrl+F) locates matching text and reports the count", async ({ page }) => {
  // Place a text element reading "Findme".
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(400, 360);
  await page.keyboard.type("Findme");
  await page.keyboard.press("Escape");

  // Open find and search — one match reported.
  await page.keyboard.press("Control+f");
  await expect(page.getByTestId("find-panel")).toBeVisible();
  await page.getByTestId("find-input").fill("findme");
  await expect(page.getByTestId("find-count")).toHaveText("1 / 1");

  // A query with no matches says so; closing hides the panel.
  await page.getByTestId("find-input").fill("zzz-nope");
  await expect(page.getByTestId("find-count")).not.toHaveText("1 / 1");
  await page.getByTestId("find-close").click();
  await expect(page.getByTestId("find-panel")).toHaveCount(0);
});
