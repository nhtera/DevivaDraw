import { test, expect } from "@playwright/test";

/**
 * Scene minimap (tldraw parity): appears when the scene has content, and clicking it pans the camera.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

/** Topmost dark-ink Y of the drawing (the rectangle's stroke on the light canvas). */
async function inkTopY(page: import("@playwright/test").Page): Promise<number> {
  const shot = await page.screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = img.width;
    cv.height = img.height;
    const ctx = cv.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    // Scan only the drawing column (x 300–600), below the top toolbar (y ≥ 110) and above the
    // bottom-right minimap — so we measure the rectangles' ink, not chrome.
    for (let y = 110; y < cv.height - 120; y += 1)
      for (let x = 300; x < 600; x += 1) {
        const i = (y * cv.width + x) * 4;
        if (d[i + 3]! > 60 && d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114 < 110) return y;
      }
    return -1;
  }, shot.toString("base64"));
}

test("the minimap is hidden on an empty scene and appears once there is content", async ({ page }) => {
  await expect(page.getByTestId("minimap")).toHaveCount(0);

  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(360, 320);
  await page.mouse.down();
  await page.mouse.move(520, 440);
  await page.mouse.up();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("minimap")).toBeVisible();
});

test("clicking the minimap pans the camera", async ({ page }) => {
  // Two rectangles far apart vertically → the scene spans much more than the viewport, so a minimap
  // click recenters the view by a large, unambiguous amount.
  const drawRect = async (x1: number, y1: number, x2: number, y2: number) => {
    await page.getByTestId("toolbar-rectangle-tool").click();
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2);
    await page.mouse.up();
    await page.keyboard.press("Escape");
  };
  await drawRect(400, 140, 480, 220);
  await drawRect(400, 640, 480, 720);

  const before = await inkTopY(page);
  expect(before).toBeGreaterThan(0);

  // Click near the bottom of the minimap → centers the lower part of the scene, pushing the topmost
  // rectangle up and out, so the topmost visible ink drops to a very different Y.
  const map = page.getByTestId("minimap");
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 10);

  await expect.poll(async () => Math.abs((await inkTopY(page)) - before)).toBeGreaterThan(60);
});
