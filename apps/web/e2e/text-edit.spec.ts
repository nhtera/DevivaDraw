import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("places and edits a text element via the text tool", async ({ page }) => {
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(400, 350);

  const textarea = page.getByTestId("text-editor-overlay-textarea");
  await expect(textarea).toBeVisible();
  await textarea.fill("Hello Deviva Draw");
  await expect(textarea).toHaveValue("Hello Deviva Draw");

  // Escape commits/exits the editor (Enter inserts a newline, matching Excalidraw/tldraw) and the
  // text tool hands control back to the select tool (see `text-tool.ts`'s `onPlaced` callback).
  await textarea.press("Escape");
  await expect(page.getByTestId("text-editor-overlay-textarea")).not.toBeVisible();
  await expect(page.getByTestId("toolbar-select-tool")).toHaveAttribute("aria-pressed", "true");

  // The committed text is a real, selectable scene element — undo is now available.
  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
});

test("while editing, the glyphs are painted on the canvas and the textarea is a transparent input (no background box)", async ({ page }) => {
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(400, 350);
  const textarea = page.getByTestId("text-editor-overlay-textarea");
  await expect(textarea).toBeVisible();
  await textarea.fill("Canvas");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));

  // The overlay is a transparent input/caret layer only: no opaque backing, no visible selection box.
  const style = await textarea.evaluate((n) => {
    const cs = getComputedStyle(n);
    return { color: cs.color, background: cs.backgroundColor };
  });
  expect(style.color).toMatch(/rgba?\(0,\s*0,\s*0,\s*0\)/);
  expect(style.background).toMatch(/rgba?\(0,\s*0,\s*0,\s*0\)/);

  // The live draft is already painted on the canvas while editing (dark ink in the text region) — the
  // canvas is the sole glyph renderer, so nothing shifts when the textarea goes away on commit.
  const draftInk = await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const x = Math.round(390 * dpr), y = Math.round(340 * dpr), w = Math.round(220 * dpr), h = Math.round(48 * dpr);
    const d = ctx.getImageData(x, y, w, h).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lum = d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114;
      if (d[i + 3]! > 60 && lum < 120) dark++;
    }
    return dark;
  });
  expect(draftInk).toBeGreaterThan(50);

  await textarea.press("Escape");
  await expect(page.getByTestId("text-editor-overlay-textarea")).not.toBeVisible();
});

test("editing text shows a focused text panel (font family/size/align), not the shape controls", async ({ page }) => {
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(400, 350);
  await expect(page.getByTestId("text-editor-overlay-textarea")).toBeVisible();

  // The focused text panel is shown, with the text-only controls...
  await expect(page.getByTestId("properties-panel-text")).toBeVisible();
  await expect(page.getByText("Font family", { exact: true })).toBeVisible();
  await expect(page.getByText("Font size", { exact: true })).toBeVisible();
  await expect(page.getByText("Text align", { exact: true })).toBeVisible();
  // ...and none of the shape-only controls (which don't apply to text).
  await expect(page.getByText("Sloppiness", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Edges", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Fill", { exact: true })).toHaveCount(0);

  await page.getByTestId("text-editor-overlay-textarea").press("Escape");
});

test("double-clicking existing standalone text re-edits it in place instead of dropping a duplicate", async ({ page }) => {
  // Place a text element.
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(500, 350);
  const textarea = page.getByTestId("text-editor-overlay-textarea");
  await expect(textarea).toBeVisible();
  await textarea.fill("sss");
  await textarea.press("Escape");
  await expect(page.getByTestId("text-editor-overlay-textarea")).not.toBeVisible();

  // Double-click on the committed glyphs: this must re-open THAT element (seeded with its text),
  // not spawn a second offset text box (the "text jumps on edit" duplicate bug).
  await page.mouse.dblclick(508, 356);
  const reedit = page.getByTestId("text-editor-overlay-textarea");
  await expect(reedit).toBeVisible();
  await expect(reedit).toHaveValue("sss");

  // Commit unchanged, then a second edit round still finds a single element (no drift, no duplicate).
  await reedit.press("Escape");
  await expect(page.getByTestId("text-editor-overlay-textarea")).not.toBeVisible();
  await page.mouse.dblclick(508, 356);
  await expect(page.getByTestId("text-editor-overlay-textarea")).toHaveValue("sss");
  await page.getByTestId("text-editor-overlay-textarea").press("Escape");
});

test("committed text lands where it was typed (no vertical jump between the editor and the canvas)", async ({ page }) => {
  // Scans the top-most dark text pixel within the canvas region of a screenshot.
  const textTopY = async (): Promise<number> => {
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
      for (let y = 140; y < 600; y += 1) {
        for (let x = 300; x < 900; x += 1) {
          const i = (y * cv.width + x) * 4;
          const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
          if (d[i + 3] > 60 && lum < 110) return y;
        }
      }
      return -1;
    }, shot.toString("base64"));
  };

  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(500, 320);
  const textarea = page.getByTestId("text-editor-overlay-textarea");
  await expect(textarea).toBeVisible();
  await textarea.fill("sss");
  await page.waitForTimeout(100);
  const whileEditing = await textTopY();

  await textarea.press("Escape");
  await expect(page.getByTestId("text-editor-overlay-textarea")).not.toBeVisible();
  await page.waitForTimeout(150);
  const afterCommit = await textTopY();

  expect(whileEditing).toBeGreaterThan(0);
  expect(afterCommit).toBeGreaterThan(0);
  // The text must not jump vertically on commit; allow only sub-2px antialias/rounding wobble.
  expect(Math.abs(afterCommit - whileEditing)).toBeLessThanOrEqual(2);
});

test("Escape commits the text and exits (matching Excalidraw/tldraw), keeping the content", async ({ page }) => {
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(400, 350);

  const textarea = page.getByTestId("text-editor-overlay-textarea");
  await expect(textarea).toBeVisible();
  await textarea.fill("Kept on escape");
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("text-editor-overlay-textarea")).not.toBeVisible();
  // The text was committed (not discarded) — undo is available and re-opening it shows the content.
  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
  await page.mouse.dblclick(410, 356);
  await expect(page.getByTestId("text-editor-overlay-textarea")).toHaveValue("Kept on escape");
  await page.getByTestId("text-editor-overlay-textarea").press("Escape");
});

test("Enter inserts a newline instead of committing (multi-line text)", async ({ page }) => {
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(400, 350);

  const textarea = page.getByTestId("text-editor-overlay-textarea");
  await expect(textarea).toBeVisible();
  await textarea.type("line one");
  await textarea.press("Enter");
  await textarea.type("line two");
  // Still editing (Enter did not commit), and the value now spans two lines.
  await expect(textarea).toBeVisible();
  await expect(textarea).toHaveValue("line one\nline two");

  await textarea.press("Escape");
  await expect(page.getByTestId("text-editor-overlay-textarea")).not.toBeVisible();
});
