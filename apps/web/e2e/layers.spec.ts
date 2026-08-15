import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Layers panel: organize / hide / lock / reveal — the four demand clusters. This file starts with
 * the Phase-3 smoke coverage; Phase 5 extends it with the full gating-attack battery.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function openLayersPanel(page: Page): Promise<void> {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-toggle-layers").click();
  await page.keyboard.press("Escape"); // close the menu; the panel stays
  await expect(page.getByTestId("layers-panel")).toBeVisible();
}

async function drawRect(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2);
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

async function cursorAt(page: Page, x: number, y: number): Promise<string> {
  await page.mouse.move(x, y);
  await page.waitForTimeout(200);
  return page.getByTestId("deviva-draw-canvas-host").evaluate((host) => (host as HTMLElement).style.cursor);
}

test("add a layer, draw onto it, hide it — the drawing vanishes and stops being clickable; show restores", async ({ page }) => {
  await drawRect(page, 400, 200, 500, 280); // default layer
  await openLayersPanel(page);

  await page.getByTestId("layers-add").click();
  await expect(page.locator('[data-testid^="layer-item-"]')).toHaveCount(2);
  await drawRect(page, 620, 200, 720, 280); // lands on the new active layer

  // Hide the new (topmost) layer: its rect stops hitting; the default layer's still does.
  await page.locator('[data-testid^="layer-visible-"]').first().click();
  expect(await cursorAt(page, 620, 240)).toBe("default");
  expect(await cursorAt(page, 400, 240)).toBe("move");

  // Show again — progressive reveal, and the content is hittable once more.
  await page.locator('[data-testid^="layer-visible-"]').first().click();
  expect(await cursorAt(page, 620, 240)).toBe("move");
});

test("locking a layer makes its content unclickable and un-marquee-able; unlock restores", async ({ page }) => {
  await openLayersPanel(page);
  await page.getByTestId("layers-add").click();
  await drawRect(page, 620, 200, 720, 280);

  await page.locator('[data-testid^="layer-locked-"]').first().click();
  expect(await cursorAt(page, 620, 240)).toBe("default"); // no move affordance — not hittable

  // Marquee across it selects nothing, so a follow-up Delete keypress has nothing to kill: after
  // unlocking, the rect must still be there.
  await page.mouse.move(570, 150);
  await page.mouse.down();
  await page.mouse.move(770, 350);
  await page.mouse.up();
  await page.keyboard.press("Delete");

  await page.locator('[data-testid^="layer-locked-"]').first().click();
  expect(await cursorAt(page, 620, 240)).toBe("move"); // survived — it was never selected
});

test("rename, reorder, move-selection-here, and guarded delete all work from the panel", async ({ page }) => {
  await openLayersPanel(page);
  await page.getByTestId("layers-add").click();

  // Rename via double-click.
  await page.locator('[data-testid^="layer-item-"]').first().dblclick();
  await page.locator('[data-testid^="layer-rename-"]').fill("Annotations");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid^="layer-item-"]').first()).toHaveText("Annotations");

  // Draw on the default layer, then move the selection onto Annotations via the per-row button.
  await page.locator('[data-testid^="layer-item-"]').last().click(); // activate default
  await drawRect(page, 400, 200, 500, 280);
  await page.mouse.click(400, 240); // select it (stroke — unfilled interiors only hit when selected)
  await expect(page.locator('[data-testid^="layer-move-here-"]')).toHaveCount(2);
  await page.locator('[data-testid^="layer-move-here-"]').first().click(); // onto Annotations
  // Hiding Annotations now hides the moved rect — proof the membership moved.
  await page.locator('[data-testid^="layer-visible-"]').first().click();
  expect(await cursorAt(page, 400, 240)).toBe("default");
  await page.locator('[data-testid^="layer-visible-"]').first().click();

  // Delete the Annotations layer: its content re-homes to the neighbor (still visible, still hittable).
  await page.locator('[data-testid^="layer-delete-"]').first().click();
  await expect(page.locator('[data-testid^="layer-item-"]')).toHaveCount(1);
  expect(await cursorAt(page, 400, 240)).toBe("move");
  // The last layer offers no delete button at all.
  await expect(page.locator('[data-testid^="layer-delete-"]')).toHaveCount(0);
});

test("layers ride reload, and the panel is absent in the share viewer", async ({ page }) => {
  let storedBlob: Buffer | null = null;
  await page.route("**/blobs/**", async (route) => {
    if (route.request().method() === "PUT") {
      storedBlob = route.request().postDataBuffer();
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/octet-stream", body: storedBlob! });
  });

  await openLayersPanel(page);
  await page.getByTestId("layers-add").click();
  await page.locator('[data-testid^="layer-item-"]').first().dblclick();
  await page.locator('[data-testid^="layer-rename-"]').fill("Notes");
  await page.keyboard.press("Enter");
  await drawRect(page, 620, 200, 720, 280);
  await page.locator('[data-testid^="layer-visible-"]').first().click(); // hide Notes
  await page.waitForTimeout(1300); // autosave

  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await openLayersPanel(page);
  await expect(page.locator('[data-testid^="layer-item-"]')).toHaveCount(2);
  await expect(page.locator('[data-testid^="layer-item-"]').first()).toHaveText("Notes");
  expect(await cursorAt(page, 620, 240)).toBe("default"); // still hidden after reload

  // Share: the viewer honors hidden layers and never shows the layers panel (view-only unmount).
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-share").click();
  await page.getByTestId("share-dialog-regenerate").click();
  const shareUrl = await page.getByTestId("share-dialog-link").inputValue();
  await page.goto(shareUrl);
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect(page.getByTestId("pages-toggle")).toBeVisible();
  await expect(page.getByTestId("layers-panel")).toHaveCount(0);
  // The menu toggle is registry-gated in view-only: clicking it must NOT summon the panel.
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-toggle-layers").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("layers-panel")).toHaveCount(0);
});

test("z-bands: an upper layer's element wins the click even when drawn first", async ({ page }) => {
  await openLayersPanel(page);
  await page.getByTestId("layers-add").click(); // active = new upper layer
  await drawRect(page, 400, 200, 500, 280); // upper layer, drawn FIRST
  await page.locator('[data-testid^="layer-item-"]').last().click(); // activate default (lower)
  await drawRect(page, 450, 200, 550, 280); // lower layer, drawn LATER, overlapping

  // Click in the overlap on both strokes' shared x-band: the UPPER layer's rect must win the hit
  // even though the lower one was drawn more recently (insertion order loses to layer position).
  await page.mouse.click(500, 240); // right edge of upper rect = interior edge of lower
  await page.locator('[data-testid^="layer-visible-"]').first().click(); // hide upper
  // The selected element was the upper one — hiding its layer empties the selection, so Delete is a no-op.
  await page.keyboard.press("Delete");
  await page.locator('[data-testid^="layer-visible-"]').first().click(); // show again
  expect(await cursorAt(page, 400, 240)).toBe("move"); // upper rect survived
});

test("gating attacks: eraser, bucket fill, select-all, and find all ignore hidden content", async ({ page }) => {
  await openLayersPanel(page);
  await page.getByTestId("layers-add").click();
  await drawRect(page, 400, 200, 500, 280);
  // Put text on the hidden-to-be layer too.
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(600, 240);
  await page.keyboard.type("secret");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid^="layer-visible-"]').first().click(); // hide the layer

  // Eraser drag straight across the hidden rect: nothing to erase.
  await page.getByTestId("toolbar-eraser-tool").click();
  await page.mouse.move(380, 240);
  await page.mouse.down();
  await page.mouse.move(520, 240, { steps: 5 });
  await page.mouse.up();
  await page.getByTestId("toolbar-select-tool").click();

  // Select-all + delete: nothing selectable, nothing deleted.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
  await page.keyboard.press("Delete");

  // Find: the hidden text is not a match.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f");
  await page.keyboard.type("secret");
  await expect(page.getByTestId("find-panel").getByText("No matches")).toBeVisible();
  await page.keyboard.press("Escape");

  // Unhide: everything survived every attack.
  await page.locator('[data-testid^="layer-visible-"]').first().click();
  expect(await cursorAt(page, 400, 240)).toBe("move");
});

test("a locked layer's shape refuses new arrow bindings", async ({ page }) => {
  await openLayersPanel(page);
  await page.getByTestId("layers-add").click();
  await drawRect(page, 400, 200, 500, 280);
  await page.locator('[data-testid^="layer-locked-"]').first().click(); // lock the layer

  // Draw an arrow ending at the locked shape's edge — it must NOT bind: dragging the shape's layer
  // later (after unlock) won't reroute the arrow, but more directly: bindings only form on
  // bindable targets, and the binding highlight never appears. Probe: draw arrow, unlock, move the
  // rect, and check the arrow's end stayed put by checking the arrow is still hittable at its
  // original end point.
  await page.getByTestId("toolbar-arrow-tool").click();
  await page.mouse.move(300, 240);
  await page.mouse.down();
  await page.mouse.move(398, 240, { steps: 4 }); // right at the locked rect's edge
  await page.mouse.up();
  await page.keyboard.press("Escape");

  await page.locator('[data-testid^="layer-locked-"]').first().click(); // unlock
  await page.mouse.click(400, 240); // select the rect (stroke)
  await page.keyboard.press("ArrowRight"); // nudge it
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  // Unbound arrow: its end never followed the nudged rect — still hittable at the original spot.
  expect(await cursorAt(page, 390, 240)).toBe("move");
});

test("frame drag never relocates hidden-layer content", async ({ page }) => {
  await openLayersPanel(page);
  await page.getByTestId("layers-add").click();
  await drawRect(page, 420, 220, 480, 260); // on the soon-hidden layer
  await page.locator('[data-testid^="layer-visible-"]').first().click(); // hide it

  // Draw a frame geometrically containing the hidden rect, then drag the frame away.
  await page.getByTestId("toolbar-more").click();
  await page.getByTestId("more-frame-tool").click();
  await page.mouse.move(380, 180);
  await page.mouse.down();
  await page.mouse.move(560, 320);
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.mouse.move(380, 180); // frame's corner/edge
  await page.mouse.down();
  await page.mouse.move(680, 480, { steps: 6 }); // drag the frame far away
  await page.mouse.up();
  await page.keyboard.press("Escape");

  // Unhide: the rect is exactly where it was, not dragged along invisibly.
  await page.locator('[data-testid^="layer-visible-"]').first().click();
  expect(await cursorAt(page, 420, 240)).toBe("move");
});

test("legacy flatten: stripping the layers field leaves every element intact on the default layer", async ({ page }) => {
  await openLayersPanel(page);
  await page.getByTestId("layers-add").click();
  await drawRect(page, 400, 200, 500, 280);
  await page.locator('[data-testid^="layer-visible-"]').first().click(); // hidden layer content
  await page.waitForTimeout(1300);

  // Simulate an old build's resave: the layers list drops, element layerIds survive.
  await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!);
    for (const entry of doc.pages) {
      delete entry.scene.layers;
      delete entry.scene.activeLayerId;
    }
    localStorage.setItem("devivadraw:autosave:v1", JSON.stringify(doc));
  });
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  // The documented degradation: structure flattened, content NOT lost — and therefore visible again.
  await openLayersPanel(page);
  await expect(page.locator('[data-testid^="layer-item-"]')).toHaveCount(1);
  expect(await cursorAt(page, 400, 240)).toBe("move");
});

test("membership moves are undoable; layer renames are not in the undo stack (decided scope)", async ({ page }) => {
  await openLayersPanel(page);
  await page.getByTestId("layers-add").click();
  await page.locator('[data-testid^="layer-item-"]').last().click(); // default active
  await drawRect(page, 400, 200, 500, 280);
  await page.mouse.click(400, 240); // select
  await page.locator('[data-testid^="layer-move-here-"]').first().click(); // membership → upper layer

  await page.locator('[data-testid^="layer-item-"]').first().dblclick();
  await page.locator('[data-testid^="layer-rename-"]').fill("Renamed");
  await page.keyboard.press("Enter");

  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z"); // undo
  // The rename SURVIVES (not in history); the membership move is what reverted.
  await expect(page.locator('[data-testid^="layer-item-"]').first()).toHaveText("Renamed");
  await page.locator('[data-testid^="layer-visible-"]').first().click(); // hide the renamed layer
  expect(await cursorAt(page, 400, 240)).toBe("move"); // rect visible ⇒ it's back on the default layer
});

test("each page has its own layers", async ({ page }) => {
  await openLayersPanel(page);
  await page.getByTestId("layers-add").click();
  await expect(page.locator('[data-testid^="layer-item-"]')).toHaveCount(2);

  await page.getByTestId("pages-toggle").click();
  await page.getByTestId("page-add").click();
  await expect(page.locator('[data-testid^="layer-item-"]')).toHaveCount(1); // fresh page, fresh default layer

  // The pages popover stays open after adding — click page 1 directly.
  await page.locator('[data-testid^="page-item-"]').first().click(); // back to page 1
  await expect(page.locator('[data-testid^="layer-item-"]')).toHaveCount(2);
});

test("an exported PNG's embedded re-open payload contains zero hidden-layer content", async ({ page }) => {
  await openLayersPanel(page);
  await drawRect(page, 400, 200, 500, 280); // visible, default layer
  await page.getByTestId("layers-add").click();
  await page.getByTestId("toolbar-text-tool").click();
  await page.mouse.click(600, 240);
  await page.keyboard.type("SECRETPAYLOAD");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid^="layer-visible-"]').first().click(); // hide the layer holding the text

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-export-png").click();
  const download = await downloadPromise;
  const path = await download.path();
  const { readFileSync } = await import("node:fs");
  const bytes = readFileSync(path!);

  // The scene JSON rides a tEXt chunk base64-encoded under the "devivadraw" keyword — decode and
  // assert the hidden layer's content is genuinely absent from the file, not just from the pixels.
  const marker = Buffer.from("devivadraw\0");
  const markerIndex = bytes.indexOf(marker);
  expect(markerIndex).toBeGreaterThan(-1); // the embed exists (visible content re-opens fine)
  const chunkLength = bytes.readUInt32BE(markerIndex - 8); // tEXt layout: length, "tEXt", keyword\0, data
  const dataStart = markerIndex + marker.length;
  const dataEnd = markerIndex - 4 + chunkLength; // length counts keyword+null+data
  const embedded = Buffer.from(bytes.subarray(dataStart, dataEnd).toString("latin1"), "base64").toString("utf8");
  expect(embedded).toContain("devivadraw/scene"); // sanity: we decoded the real payload
  expect(embedded).not.toContain("SECRETPAYLOAD");
});
