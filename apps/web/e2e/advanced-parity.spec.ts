import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import * as fs from "node:fs";

/** A 200x100 PNG: left half opaque red, right half opaque blue (same fixture as `image-flip.spec.ts`). */
const RED_BLUE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAMgAAABkCAYAAADDhn8LAAACKElEQVR4nO3OoQEAMBCEsN9/6daywSEQ8bl39+IhKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqBD1YGrNb1yxc1AAAAAElFTkSuQmCC";

/**
 * The round-5 power features: editable stats panel, Alt+Arrow flowchart node spawning, the image
 * crop editor, export extras (dark mode / selection-only), and the exported-PNG scene round-trip
 * (a Deviva PNG carries its scene and reopens as a document when dropped back in).
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function drawRect(page: Page): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(400, 380);
  await page.mouse.up();
}

async function liveElements(page: Page): Promise<Array<Record<string, unknown>>> {
  await page.waitForTimeout(1300);
  return page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!) as { pages: Array<{ scene: { elements: Array<{ isDeleted?: boolean }> } }> };
    return doc.pages[0]!.scene.elements.filter((element) => !element.isDeleted) as Array<Record<string, unknown>>;
  });
}

test("the stats panel edits a selected element's position exactly", async ({ page }) => {
  await drawRect(page); // auto-selected
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-toggle-stats").click();

  await expect(page.getByTestId("stats-element-count")).toHaveText("1");
  await page.getByTestId("stats-x").fill("512");
  await page.getByTestId("stats-x").press("Enter");
  await page.getByTestId("stats-angle").fill("45");
  await page.getByTestId("stats-angle").press("Enter");

  const [rect] = await liveElements(page);
  expect(rect!.x).toBe(512);
  expect(rect!.angle as number).toBeCloseTo(Math.PI / 4, 3);
});

test("Alt+ArrowRight grows a flowchart: a connected sibling spawns and chains", async ({ page }) => {
  await drawRect(page); // auto-selected, 100x80 at (300,300)
  await page.keyboard.press("Alt+ArrowRight");

  let elements = await liveElements(page);
  expect(elements).toHaveLength(3); // source, node, connector
  const arrow = elements.find((element) => element.type === "arrow")!;
  expect((arrow.startBinding as { elementId: string }).elementId).toBeTruthy();
  expect((arrow.endBinding as { elementId: string }).elementId).toBeTruthy();
  const node = elements.find((element) => element.type === "rectangle" && element.x !== 300)!;
  expect(node.x).toBe(300 + 100 + 96); // source right edge + gap

  // The spawned node is selected, so a second press chains from it.
  await page.keyboard.press("Alt+ArrowDown");
  elements = await liveElements(page);
  expect(elements).toHaveLength(5);
});

test("double-click crops an image; Enter commits, Escape restores", async ({ page }) => {
  // The 200x100 red/blue swatch `image-flip.spec.ts` uses — big enough that the eight crop handles
  // don't overlap (a tiny image collapses them onto one spot and the drag grabs the wrong one).
  const png = Buffer.from(RED_BLUE_PNG, "base64");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("toolbar-image").click()]);
  await chooser.setFiles({ name: "halves.png", mimeType: "image/png", buffer: png });
  await expect(async () => {
    await page.mouse.move(499, 400);
    await page.mouse.move(500, 400);
    await expect(page.getByTestId("image-placement-ghost")).toBeVisible({ timeout: 200 });
  }).toPass();
  await page.mouse.click(500, 400);
  const [placed] = await liveElements(page);
  const width = placed!.width as number;

  // Enter crop mode and pull the east handle half-way in.
  await page.mouse.dblclick(500, 400);
  await expect(page.getByTestId("image-crop-overlay")).toBeVisible();
  const east = (await page.getByTestId("image-crop-handle-e").boundingBox())!;
  await page.mouse.move(east.x + east.width / 2, east.y + east.height / 2);
  await page.mouse.down();
  await page.mouse.move(east.x + east.width / 2 - width / 2, east.y + east.height / 2);
  await page.mouse.up();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("image-crop-overlay")).toHaveCount(0);

  const [cropped] = await liveElements(page);
  expect((cropped!.crop as { width: number }).width).toBeLessThan(0.6);
  expect(cropped!.width as number).toBeLessThan(width * 0.6);

  // Escape leaves the geometry as the session found it (version stamps bump — a restore is a write).
  const geometryOf = (element: Record<string, unknown>) => JSON.stringify([element.x, element.y, element.width, element.height, element.crop]);
  const before = geometryOf(cropped!);
  await page.mouse.dblclick(400, 400); // inside the remaining (left) half
  await expect(page.getByTestId("image-crop-overlay")).toBeVisible();
  const south = (await page.getByTestId("image-crop-handle-s").boundingBox())!;
  await page.mouse.move(south.x + 5, south.y + 5);
  await page.mouse.down();
  await page.mouse.move(south.x + 5, south.y - 20);
  await page.mouse.up();
  await page.keyboard.press("Escape");
  const [restored] = await liveElements(page);
  expect(geometryOf(restored!)).toBe(before);
});

test("the export dialog offers dark-mode and selection-only, and both still download", async ({ page }) => {
  await drawRect(page); // auto-selected
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-export-image").click();

  await page.getByTestId("export-dark-mode").check();
  await page.getByTestId("export-only-selected").check();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-png").click()]);
  expect(download.suggestedFilename()).toContain(".png");
});

test("a Deviva-exported PNG dropped back in reopens the scene it carries", async ({ page }) => {
  await drawRect(page);
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-export-image").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-png").click()]);
  const pngBase64 = fs.readFileSync((await download.path())!).toString("base64");
  await page.keyboard.press("Escape"); // close the dialog

  // Wipe the board, then drop the exported PNG onto the canvas.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const file = new File([bytes], "export.png", { type: "image/png" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const host = document.querySelector('[data-testid="deviva-draw-canvas-host"]')!;
    host.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, clientX: 500, clientY: 400 }));
  }, pngBase64);

  // The rectangle is back as an editable element — not as a flattened picture.
  await expect
    .poll(async () => {
      const elements = await liveElements(page);
      return elements.map((element) => element.type);
    })
    .toEqual(["rectangle"]);
});
