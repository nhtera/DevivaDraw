import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Flipping an image. Unlike a shape, a photo has no mirrored outline to switch to and cannot be faked
 * with a half turn, so the flip is recorded on the element and applied when it is drawn — which means
 * both halves have to be checked: that the field changes, and that the canvas actually looks mirrored.
 */

/** A 200x100 PNG: left half opaque red, right half opaque blue — so a horizontal mirror is unmistakable. */
const RED_BLUE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAMgAAABkCAYAAADDhn8LAAACKElEQVR4nO3OoQEAMBCEsN9/6daywSEQ8bl39+IhKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqh/SAkKIT2g5CgENoPQoJCaD8ICQqBD1YGrNb1yxc1AAAAAElFTkSuQmCC";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function insertImage(page: Page): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("toolbar-image").click()]);
  await chooser.setFiles({ name: "swatch.png", mimeType: "image/png", buffer: Buffer.from(RED_BLUE_PNG, "base64") });
  await expect.poll(async () => (await imageElement(page))?.type).toBe("image");
}

async function imageElement(page: Page): Promise<{ type: string; x: number; y: number; width: number; height: number; scale?: number[] } | undefined> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("devivadraw:autosave:v1");
    if (!raw) return undefined;
    const scene = JSON.parse(raw) as { elements: Array<{ type: string; x: number; y: number; width: number; height: number; scale?: number[]; isDeleted?: boolean }> };
    return scene.elements.find((element) => element.type === "image" && !element.isDeleted);
  });
}

/** Mean colour of a small patch of the canvas, in scene/screen coordinates (camera is at the origin, unzoomed). */
async function patchColor(page: Page, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
  return page.evaluate(
    ([px, py]) => {
      const canvases = [...document.querySelector('[data-testid="deviva-draw-canvas-host"]')!.querySelectorAll("canvas")];
      const dpr = window.devicePixelRatio || 1;
      // The static layer (elements) is beneath the interactive one (selection frame).
      const ctx = canvases[0]!.getContext("2d")!;
      const data = ctx.getImageData(Math.round(px! * dpr), Math.round(py! * dpr), Math.round(6 * dpr), Math.round(6 * dpr)).data;
      let r = 0;
      let g = 0;
      let b = 0;
      const pixels = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]!;
        g += data[i + 1]!;
        b += data[i + 2]!;
      }
      return { r: r / pixels, g: g / pixels, b: b / pixels };
    },
    [x, y],
  );
}

test("Shift+H mirrors an image on the canvas, and flipping again restores it", async ({ page }) => {
  await insertImage(page);
  const placed = (await imageElement(page))!;
  expect(placed.scale).toEqual([1, 1]);

  // Sample well inside each half of the placed image.
  const leftPatch = { x: placed.x + placed.width * 0.2, y: placed.y + placed.height * 0.5 };
  const rightPatch = { x: placed.x + placed.width * 0.8, y: placed.y + placed.height * 0.5 };

  const before = { left: await patchColor(page, leftPatch.x, leftPatch.y), right: await patchColor(page, rightPatch.x, rightPatch.y) };
  expect(before.left.r).toBeGreaterThan(before.left.b); // red half on the left
  expect(before.right.b).toBeGreaterThan(before.right.r); // blue half on the right

  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Shift+H");

  // The element records the flip...
  await expect.poll(async () => (await imageElement(page))?.scale).toEqual([-1, 1]);
  // ...and the canvas really shows it: the halves have swapped sides.
  await expect
    .poll(async () => {
      const after = await patchColor(page, leftPatch.x, leftPatch.y);
      return after.b > after.r;
    })
    .toBe(true);
  const afterRight = await patchColor(page, rightPatch.x, rightPatch.y);
  expect(afterRight.r).toBeGreaterThan(afterRight.b);

  // A mirror is its own inverse.
  await page.keyboard.press("Shift+H");
  await expect.poll(async () => (await imageElement(page))?.scale).toEqual([1, 1]);
});

test("Shift+V flips an image on the other axis, leaving the horizontal one alone", async ({ page }) => {
  await insertImage(page);
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Shift+V");
  await expect.poll(async () => (await imageElement(page))?.scale).toEqual([1, -1]);
});

test("a flipped image survives a reload", async ({ page }) => {
  await insertImage(page);
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Shift+H");
  await expect.poll(async () => (await imageElement(page))?.scale).toEqual([-1, 1]);

  // The field has to pass scene validation on the way back in, or the whole document fails to restore.
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  expect((await imageElement(page))?.scale).toEqual([-1, 1]);
});
