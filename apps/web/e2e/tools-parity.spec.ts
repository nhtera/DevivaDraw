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
      const canvases = [...document.querySelector('[data-testid="deviva-draw-canvas-host"]')!.querySelectorAll("canvas")];
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

  // Choosing arms a placement: a ghost follows the cursor, and the drop happens on the next canvas
  // click. The ghost first paints on the pointermove *after* the async decode arms it, so nudge the
  // mouse until it shows rather than racing the decode with a single move.
  await expect(async () => {
    await page.mouse.move(599, 400);
    await page.mouse.move(600, 400);
    await expect(page.getByTestId("image-placement-ghost")).toBeVisible({ timeout: 200 });
  }).toPass();
  await page.mouse.click(600, 400);
  await expect(page.getByTestId("image-placement-ghost")).toHaveCount(0);

  // The image was inserted (undoable) and auto-selected — the layer actions only render for a selection.
  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();

  // ...and it landed centered on the click, not at the viewport centre.
  await page.waitForTimeout(1300);
  const inserted = await page.evaluate(() => {
    const scene = JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!) as { elements: Array<Record<string, number | string>> };
    const image = scene.elements.find((element) => element.type === "image")!;
    return { cx: (image.x as number) + (image.width as number) / 2, cy: (image.y as number) + (image.height as number) / 2 };
  });
  expect(inserted.cx).toBeCloseTo(600, 0);
  expect(inserted.cy).toBeCloseTo(400, 0);
});

test("Escape abandons an armed image placement without inserting", async ({ page }) => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("toolbar-image").click()]);
  await chooser.setFiles({ name: "pixel.png", mimeType: "image/png", buffer: png });
  await expect(async () => {
    await page.mouse.move(599, 400);
    await page.mouse.move(600, 400);
    await expect(page.getByTestId("image-placement-ghost")).toBeVisible({ timeout: 200 });
  }).toPass();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("image-placement-ghost")).toHaveCount(0);
  await expect(page.getByTestId("top-bar-undo")).toBeDisabled(); // nothing was inserted
});

test("the laser pointer draws a fading red trail and leaves nothing on the canvas", async ({ page }) => {
  // Counts laser-red pixels (rgb ~255,45,45) on the interactive (top) canvas.
  const redPixels = (): Promise<number> =>
    page.evaluate(() => {
      const canvases = [...document.querySelector('[data-testid="deviva-draw-canvas-host"]')!.querySelectorAll("canvas")];
      const cv = canvases[canvases.length - 1]!; // interactive overlay is on top
      const d = cv.getContext("2d")!.getImageData(0, 0, cv.width, cv.height).data;
      let red = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! > 150 && d[i + 1]! < 110 && d[i + 2]! < 110 && d[i + 3]! > 50) red++;
      return red;
    });

  // The laser now lives in the More overflow menu (it's a specialty tool, off the main row).
  await page.getByTestId("toolbar-more").click();
  await page.getByTestId("more-laser-tool").click();
  await page.mouse.move(300, 400);
  await page.mouse.down();
  for (let x = 320; x <= 700; x += 20) await page.mouse.move(x, 400);
  await page.mouse.up();

  expect(await redPixels()).toBeGreaterThan(20); // the trail is visible right after drawing
  await expect(page.getByTestId("top-bar-undo")).toBeDisabled(); // purely ephemeral — nothing added to the scene
  await expect.poll(redPixels, { timeout: 3000 }).toBe(0); // and it fades away completely
});

test("the More overflow menu opens an icon grid of the secondary tools and closes on outside click", async ({ page }) => {
  await expect(page.getByTestId("more-tools-popover")).toHaveCount(0);

  await page.getByTestId("toolbar-more").click();
  await expect(page.getByTestId("more-tools-popover")).toBeVisible();
  // It houses the extra shapes + specialty tools.
  for (const id of ["more-triangle-tool", "more-hexagon-tool", "more-star-tool", "more-highlighter-tool", "more-frame-tool", "more-laser-tool", "more-lasso-tool"]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }

  // Clicking the canvas (outside the popover) dismisses it.
  await page.mouse.click(700, 500);
  await expect(page.getByTestId("more-tools-popover")).toHaveCount(0);
});

test("picking an extra shape from the More menu drops it and hands back to select", async ({ page }) => {
  await page.getByTestId("toolbar-more").click();
  await page.getByTestId("more-star-tool").click();
  await expect(page.getByTestId("more-tools-popover")).toHaveCount(0); // popover closed on pick
  await page.mouse.click(500, 380);

  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
  await expect(page.getByTestId("toolbar-select-tool")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();
});

test("the highlighter (from More) commits a translucent stroke", async ({ page }) => {
  await page.getByTestId("toolbar-more").click();
  await page.getByTestId("more-highlighter-tool").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  for (let x = 300; x <= 480; x += 20) await page.mouse.move(x, 300);
  await page.mouse.up();

  // A stroke element was committed (undoable) and control handed back to select.
  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
  await expect(page.getByTestId("toolbar-select-tool")).toHaveAttribute("aria-pressed", "true");
});

test("a frame drags its contents with it", async ({ page }) => {
  // Topmost dark-ink Y in the drawing region (the rectangle's dark stroke on the light canvas; the
  // frame's own gray border is above the ink-luminance threshold, so only the rectangle counts).
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
      for (let y = 150; y < 800; y += 1)
        for (let x = 250; x < 470; x += 1) {
          const i = (y * cv.width + x) * 4;
          if (d[i + 3]! > 60 && d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114 < 110) return y;
        }
      return -1;
    }, shot.toString("base64"));
  };

  // Draw a rectangle.
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(320, 300);
  await page.mouse.down();
  await page.mouse.move(420, 380);
  await page.mouse.up();
  const before = await inkTopY();
  expect(before).toBeGreaterThan(0);

  // Draw a frame enclosing the rectangle (auto-selected on release).
  await page.getByTestId("toolbar-more").click();
  await page.getByTestId("more-frame-tool").click();
  await page.mouse.move(290, 270);
  await page.mouse.down();
  await page.mouse.move(450, 420);
  await page.mouse.up();

  // Drag the selected frame from an empty interior point (below the rectangle) straight down.
  await page.mouse.move(300, 410);
  await page.mouse.down();
  await page.mouse.move(300, 560);
  await page.mouse.up();

  expect((await inkTopY()) - before).toBeGreaterThan(80); // the rectangle moved down with the frame
});

test("the lasso selects every element a traced loop encloses", async ({ page }) => {
  // Draw a rectangle, then deselect it.
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(320, 300);
  await page.mouse.down();
  await page.mouse.move(400, 370);
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-testid^="layer-action-"]')).toHaveCount(0); // nothing selected

  // Lasso a loop around the rectangle.
  await page.getByTestId("toolbar-more").click();
  await page.getByTestId("more-lasso-tool").click();
  await page.mouse.move(290, 270);
  await page.mouse.down();
  for (const [x, y] of [[430, 270], [430, 400], [290, 400], [290, 270]] as const) await page.mouse.move(x, y);
  await page.mouse.up();

  // The rectangle is now selected (its layer actions render only for a non-empty selection).
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();
});

test("the sticky-note tool sits on the main toolbar and drops a note", async ({ page }) => {
  await expect(page.getByTestId("toolbar-note-tool")).toBeVisible();
  await page.getByTestId("toolbar-note-tool").click();
  await page.mouse.click(500, 400); // click-to-place a default note

  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
  await expect(page.getByTestId("toolbar-select-tool")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();
});

test("a shape created from the More menu can be resized by its handles (regression: they used to ignore resize)", async ({ page }) => {
  // Rightmost dark-ink X in the drawing region (the star's dark stroke on the light canvas).
  const rightmostInkX = async (): Promise<number> => {
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
      for (let x = 760; x >= 380; x -= 1)
        for (let y = 280; y < 640; y += 1) {
          const i = (y * cv.width + x) * 4;
          if (d[i + 3]! > 60 && d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114 < 110) return x;
        }
      return -1;
    }, shot.toString("base64"));
  };

  // Click-place a default star (auto-selected); its bbox is ~100px centered on the click.
  await page.getByTestId("toolbar-more").click();
  await page.getByTestId("more-star-tool").click();
  await page.mouse.click(500, 420);
  const before = await rightmostInkX();
  expect(before).toBeGreaterThan(0);

  // Drag its bottom-right resize handle outward.
  await page.mouse.move(550, 470);
  await page.mouse.down();
  await page.mouse.move(700, 620);
  await page.mouse.up();

  expect((await rightmostInkX()) - before).toBeGreaterThan(60); // the star grew to the right
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
