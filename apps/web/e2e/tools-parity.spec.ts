import { test, expect } from "@playwright/test";

/**
 * Parity with Excalidraw/tldraw for the non-text tools: a clean idle canvas (no panel until a tool is
 * active or something is selected), click-to-place a default shape, and the eraser tool.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("the properties panel is hidden on the idle canvas and appears once a creation tool is active", async ({ page }) => {
  // Idle: select tool active, nothing selected → clean canvas, no panel (matching competitors).
  await expect(page.getByTestId("properties-panel")).toHaveCount(0);

  // A creation tool shows the panel (its "next shape" defaults).
  await page.getByTestId("toolbar-rectangle-tool").click();
  await expect(page.getByTestId("properties-panel")).toBeVisible();

  // Back to the select tool with nothing selected → hidden again.
  await page.getByTestId("toolbar-select-tool").click();
  await expect(page.getByTestId("properties-panel")).toHaveCount(0);
});

test("clicking (no drag) with a shape tool drops a default-sized shape and selects it", async ({ page }) => {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.click(500, 380); // a plain click, not a drag

  // A real element was created (undoable) and auto-selected — control handed back to select.
  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
  await expect(page.getByTestId("toolbar-select-tool")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();
});

test("the eraser tool removes an element dragged over, and has a toolbar button + shortcut", async ({ page }) => {
  // Counts "ink" pixels (dark stroke on the default light canvas) in the shape's region.
  const inkInRegion = async (): Promise<number> =>
    page.evaluate(() => {
      const canvases = [...document.querySelectorAll("canvas")];
      const cv = canvases[canvases.length - 2]!; // static layer holds committed elements
      const ctx = cv.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;
      const d = ctx.getImageData(Math.round(280 * dpr), Math.round(280 * dpr), Math.round(240 * dpr), Math.round(180 * dpr)).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4) {
        const lum = d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114;
        if (d[i + 3]! > 120 && lum < 120) ink++;
      }
      return ink;
    });

  // Draw a rectangle by dragging.
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(500, 440);
  await page.mouse.up();
  expect(await inkInRegion()).toBeGreaterThan(20); // ink is present

  // The eraser has its own toolbar button, and its shortcut selects it.
  await expect(page.getByTestId("toolbar-eraser-tool")).toBeVisible();
  await page.keyboard.press("e");
  await expect(page.getByTestId("toolbar-eraser-tool")).toHaveAttribute("aria-pressed", "true");

  // Swipe across the rectangle's edges — its ink is gone afterward.
  await page.mouse.move(290, 370);
  await page.mouse.down();
  for (let x = 290; x <= 510; x += 15) await page.mouse.move(x, 370);
  await page.mouse.up();

  await expect.poll(inkInRegion).toBeLessThan(5);
});

test("the image toolbar button inserts an image via the file picker and selects it", async ({ page }) => {
  // A minimal valid 1x1 PNG — enough to exercise the decode + insert + select pipeline.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("toolbar-image").click()]);
  await chooser.setFiles({ name: "pixel.png", mimeType: "image/png", buffer: png });

  // The image was inserted (undoable) and auto-selected — the layer actions only render for a selection.
  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();
});

test("the laser pointer draws a fading red trail and leaves nothing on the canvas", async ({ page }) => {
  // Counts laser-red pixels (rgb ~255,45,45) on the interactive (top) canvas.
  const redPixels = (): Promise<number> =>
    page.evaluate(() => {
      const canvases = [...document.querySelectorAll("canvas")];
      const cv = canvases[canvases.length - 1]!; // interactive overlay is on top
      const d = cv.getContext("2d")!.getImageData(0, 0, cv.width, cv.height).data;
      let red = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! > 150 && d[i + 1]! < 110 && d[i + 2]! < 110 && d[i + 3]! > 50) red++;
      return red;
    });

  await page.getByTestId("toolbar-laser-tool").click();
  await page.mouse.move(300, 400);
  await page.mouse.down();
  for (let x = 320; x <= 700; x += 20) await page.mouse.move(x, 400);
  await page.mouse.up();

  expect(await redPixels()).toBeGreaterThan(20); // the trail is visible right after drawing
  await expect(page.getByTestId("top-bar-undo")).toBeDisabled(); // purely ephemeral — nothing added to the scene
  await expect.poll(redPixels, { timeout: 3000 }).toBe(0); // and it fades away completely
});

test("a selected element is moved by dragging from inside its bounding box, not only its thin geometry", async ({ page }) => {
  // Topmost dark-ink Y within the drawing region (the line is dark on the default light canvas).
  const inkTopY = async (): Promise<number> => {
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
      for (let y = 150; y < 780; y += 1)
        for (let x = 250; x < 560; x += 1) {
          const i = (y * cv.width + x) * 4;
          if (d[i + 3]! > 60 && d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114 < 110) return y;
        }
      return -1;
    }, shot.toString("base64"));
  };

  // A diagonal line: its bounding box is 200×200 but the stroke itself is a 1px hairline.
  await page.getByTestId("toolbar-line-tool").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(500, 500);
  await page.mouse.up();
  const before = await inkTopY();
  expect(before).toBeGreaterThan(0);

  // Grab an EMPTY interior point (330,470) — inside the bbox but ~100px off the diagonal — and drag
  // down. Before the fix this started a marquee (deselect); now it moves the selected line.
  await page.mouse.move(330, 470);
  await page.mouse.down();
  await page.mouse.move(330, 620);
  await page.mouse.up();

  expect((await inkTopY()) - before).toBeGreaterThan(80); // the line moved down with the interior drag
});
