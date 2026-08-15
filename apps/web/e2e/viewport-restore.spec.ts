import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Per-page camera persistence: a share link, an autosave reload, and a reopened document land the
 * reader exactly where the writer was looking. The probes are behavioral, not internal: the top-bar
 * zoom readout proves the zoom leg, and the back-to-content pill proves the scroll leg — it only
 * shows while every element is off-screen, so "pill still visible after restore" means the restored
 * scroll really is the far-away viewport, not a reset to origin (where the content would be in view).
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function drawRect(page: Page): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(600, 420);
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

/** Zoom in one step via the zoom menu, then hand-pan the content far off-screen. Returns the zoom readout to compare after restore. */
async function zoomAndPanAway(page: Page): Promise<string> {
  // Wheel events rather than a hand-tool drag: synthetic pointer drags don't drive the pan gesture
  // pipeline, but wheel scrolling is the same camera path a trackpad takes (see
  // navigation-affordances.spec.ts's panFarAway). Pan first, zoom after — the pill only needs the
  // scroll leg, and zooming in around the viewport center keeps off-screen content off-screen.
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="deviva-draw-canvas-host"] canvas')!;
    for (let i = 0; i < 12; i += 1) {
      canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 600, clientX: 700, clientY: 400, bubbles: true, cancelable: true }));
    }
  });
  await expect(page.getByTestId("back-to-content")).toBeVisible();

  await page.getByTestId("top-bar-zoom-percentage").click();
  await page.getByTestId("zoom-menu-zoom-in").click();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("back-to-content")).toBeVisible();
  const zoomText = await page.getByTestId("top-bar-zoom-percentage").innerText();
  expect(zoomText).not.toBe("100%");
  return zoomText;
}

test("a share link opens at the sharer's exact viewport", async ({ page }) => {
  let storedBlob: Buffer | null = null;
  await page.route("**/blobs/**", async (route) => {
    if (route.request().method() === "PUT") {
      storedBlob = route.request().postDataBuffer();
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/octet-stream", body: storedBlob! });
  });

  await drawRect(page);
  const zoomText = await zoomAndPanAway(page);

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-share").click();
  const shareUrl = await page.getByTestId("share-dialog-link").inputValue();

  await page.goto(shareUrl);
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect(page.getByTestId("top-bar-zoom-percentage")).toHaveText(zoomText);
  await expect(page.getByTestId("back-to-content")).toBeVisible();
});

test("an autosave reload restores the viewport, including camera-only changes after the last edit", async ({ page }) => {
  await drawRect(page);
  // The zoom/pan below happen AFTER the draw-triggered write, so the final debounced write is
  // caused purely by camera changes — proving pan/zoom alone reaches storage.
  const zoomText = await zoomAndPanAway(page);
  await page.waitForTimeout(1300);

  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect(page.getByTestId("top-bar-zoom-percentage")).toHaveText(zoomText);
  await expect(page.getByTestId("back-to-content")).toBeVisible();

  // The restored scroll is a real position, not a cosmetic value: back-to-content still knows the
  // way home from it.
  await page.getByTestId("back-to-content").click();
  await expect(page.getByTestId("back-to-content")).toBeHidden();
});

test("a reopened document file restores the viewport (the replace-document path)", async ({ page }) => {
  await drawRect(page);
  const zoomText = await zoomAndPanAway(page);
  await page.waitForTimeout(1300);
  // The autosaved document IS a valid .devivadraw file (same envelope) and now carries the cameras —
  // dropping it back in exercises the document-replace path ("Open" uses the same reader).
  const savedDocument = await page.evaluate(() => JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!) as unknown);

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect(page.getByTestId("top-bar-zoom-percentage")).toHaveText("100%");

  const dataTransfer = await page.evaluateHandle(
    ([fileName, json]) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([json!], fileName!, { type: "application/json" }));
      return transfer;
    },
    ["board.devivadraw", JSON.stringify(savedDocument)],
  );
  await page.getByTestId("deviva-draw-canvas-host").dispatchEvent("drop", { dataTransfer });

  await expect(page.getByTestId("top-bar-zoom-percentage")).toHaveText(zoomText);
  await expect(page.getByTestId("back-to-content")).toBeVisible();
});

test("a legacy document without cameras opens exactly as before", async ({ page }) => {
  await drawRect(page);
  await zoomAndPanAway(page);
  await page.waitForTimeout(1300);
  // Rewrite the slot to what a pre-camera build wrote: same pages, no appState anywhere.
  await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!);
    for (const entry of doc.pages) delete entry.scene.appState;
    localStorage.setItem("devivadraw:autosave:v1", JSON.stringify(doc));
  });

  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect(page.getByTestId("top-bar-zoom-percentage")).toHaveText("100%");
  await expect(page.getByTestId("back-to-content")).toBeHidden(); // origin camera: the rect is in view
});
