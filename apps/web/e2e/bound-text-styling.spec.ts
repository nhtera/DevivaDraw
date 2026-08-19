import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

/**
 * A label's font size, reached from the shape's own properties panel.
 *
 * The label is the thing a user points at when they say the text is too small, but it is a separate
 * element from the shape they have selected — so the panel has to reach *through* the selection to
 * find it, and the container has to absorb the size change afterwards. Both halves are asserted here
 * because either one alone looks like a working feature and isn't: a font size that applies but
 * leaves the box its old height spills the text straight out of the shape.
 */
test("changing font size from a labelled shape's panel resizes the label and its container", async ({ page }) => {
  /** The active page's live elements, straight out of the autosaved document. */
  const liveElements = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("devivadraw:autosave:v1");
      if (!raw) return [] as Array<Record<string, number | string | boolean>>;
      const parsed = JSON.parse(raw) as { pages?: Array<{ id: string; scene: { elements: [] } }>; activePageId?: string; elements?: [] };
      const scene = parsed.pages ? (parsed.pages.find((entry) => entry.id === parsed.activePageId) ?? parsed.pages[0]!).scene : (parsed as { elements: [] });
      return (scene.elements as Array<Record<string, number | string | boolean>>).filter((element) => !element.isDeleted);
    });

  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(320, 260);
  await page.mouse.down();
  await page.mouse.move(560, 306, { steps: 6 }); // deliberately shallow: XL will not fit at this height
  await page.mouse.up();

  // Give it a label, then select the shape itself — not the label.
  await page.mouse.dblclick(440, 283);
  const textarea = page.getByTestId("text-editor-overlay-textarea");
  await expect(textarea).toBeVisible();
  await textarea.fill("label");
  await textarea.press("Escape");
  await page.mouse.click(440, 283);

  await expect.poll(async () => (await liveElements()).filter((element) => element.type === "text").length).toBe(1);
  const before = (await liveElements()) as Array<{ type: string; fontSize?: number; height: number }>;
  const boxHeightBefore = before.find((element) => element.type === "rectangle")!.height;

  // XL — the control only exists here because the panel follows the shape's bound-text ref.
  const extraLarge = page.getByTestId("font-size-36");
  await expect(extraLarge).toBeVisible();
  await extraLarge.click();

  await expect
    .poll(async () => {
      const elements = (await liveElements()) as Array<{ type: string; fontSize?: number; height: number }>;
      const label = elements.find((element) => element.type === "text");
      const box = elements.find((element) => element.type === "rectangle");
      return { fontSize: label?.fontSize, grew: !!box && box.height > boxHeightBefore };
    })
    .toEqual({ fontSize: 36, grew: true });

  // One undo, not two: the size change and the container regrow are a single user action.
  await page.getByTestId("top-bar-undo").click();
  await expect.poll(async () => ((await liveElements()) as Array<{ type: string; fontSize?: number }>).find((element) => element.type === "text")?.fontSize).toBe(20);
});
