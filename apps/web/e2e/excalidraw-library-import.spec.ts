import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Importing an Excalidraw `.excalidrawlib` into the personal library, end to end through the real
 * file picker — the published Excalidraw libraries are the main reason to have this at all.
 *
 * The fixture is the **v1** envelope (`library: Element[][]`, `strokeSharpness`, `boundElementIds`),
 * which is what excalidraw.com's older published libraries still ship, and it deliberately contains an
 * `image` element: images reference a `files` sidecar that a library item has nowhere to store, so
 * they are dropped, and the panel has to say so rather than quietly thinning the item out.
 */

const GROUPED_ITEM = [
  { type: "rectangle", id: "r1", x: 0, y: 0, width: 120, height: 60, strokeColor: "#000000", backgroundColor: "#eeeeee", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 1, opacity: 100, angle: 0, seed: 111, groupIds: ["src-group"], strokeSharpness: "round", boundElementIds: [] },
  { type: "ellipse", id: "e1", x: 140, y: 0, width: 60, height: 60, strokeColor: "#000000", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 1, opacity: 100, angle: 0, seed: 222, groupIds: ["src-group"], strokeSharpness: "sharp", boundElementIds: [] },
  { type: "text", id: "t1", x: 10, y: 20, width: 100, height: 20, strokeColor: "#000000", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 1, opacity: 100, angle: 0, seed: 333, groupIds: ["src-group"], strokeSharpness: "sharp", boundElementIds: [], text: "Server", fontSize: 16, fontFamily: 1, textAlign: "center", verticalAlign: "top" },
];

const LIBRARY_FILE = {
  type: "excalidrawlib",
  version: 1,
  source: "https://excalidraw.com",
  library: [GROUPED_ITEM, [{ type: "diamond", id: "d1", x: 0, y: 0, width: 80, height: 80, strokeColor: "#000000", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 1, opacity: 100, angle: 0, seed: 444, groupIds: [], strokeSharpness: "sharp", boundElementIds: [] }, { type: "image", id: "i1", x: 0, y: 0, width: 40, height: 40, fileId: "abc", groupIds: [] }]],
};

test.beforeEach(async ({ page }) => {
  // Force the `<input type="file">` fallback in `pickAndReadFile`. Chromium exposes the File System
  // Access API on localhost, and its native dialog is out of Playwright's reach — the fallback is the
  // only branch a test can drive.
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function openLibrary(page: Page): Promise<void> {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-library").click();
  await expect(page.getByTestId("library-panel")).toBeVisible();
}

async function importFixture(page: Page, contents: unknown, name = "system-design.excalidrawlib"): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("library-import").click()]);
  await chooser.setFiles({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(contents)) });
}

/** Non-deleted element count from the persisted scene — deletes are tombstones, so `isDeleted` has to be filtered. */
async function liveElementCount(page: Page): Promise<number> {
  await page.waitForTimeout(1300); // autosave debounce
  return page.evaluate(() => {
    const raw = localStorage.getItem("devivadraw:autosave:v1");
    if (!raw) return 0;
    const scene = ((autosaved: unknown) => { const doc = autosaved as { pages?: Array<{ id: string; scene: unknown }>; activePageId?: string }; return doc.pages ? (doc.pages.find((entry) => entry.id === doc.activePageId) ?? doc.pages[0]!).scene : autosaved; })(JSON.parse(raw)) as { elements: Array<{ isDeleted?: boolean }> };
    return scene.elements.filter((element) => !element.isDeleted).length;
  });
}

test("an .excalidrawlib imports as library items, reporting what could not be converted", async ({ page }) => {
  await openLibrary(page);
  await importFixture(page, LIBRARY_FILE);

  await expect(page.getByTestId("library-item")).toHaveCount(2);
  const status = page.getByTestId("library-status");
  await expect(status).toContainText("2");
  await expect(status).toContainText("image"); // the dropped element type is named, not just counted
});

test("imported items land on their own shelf, leaving the personal one alone", async ({ page }) => {
  await openLibrary(page);
  // A hand-saved item first, so the two shelves are distinguishable by count.
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(400, 380);
  await page.mouse.up();
  await page.getByTestId("library-add").click();
  await expect(page.getByTestId("library-item")).toHaveCount(1);
  await expect(page.getByTestId("library-imported-heading")).toHaveCount(0); // no shelf until there is something on it

  await importFixture(page, LIBRARY_FILE);
  await expect(page.getByTestId("library-imported-heading")).toBeVisible();
  await expect(page.getByTestId("library-item")).toHaveCount(3); // 1 personal + 2 imported

  // The "add selection" tile belongs to the personal shelf only — an imported collection is not a
  // place to save into.
  await expect(page.getByTestId("library-add")).toHaveCount(1);
});

test("an imported item drops onto the canvas with its shapes and text intact", async ({ page }) => {
  await openLibrary(page);
  await importFixture(page, LIBRARY_FILE);

  await page.getByTestId("library-item").first().click();
  expect(await liveElementCount(page)).toBe(3); // rectangle + ellipse + text, none lost in translation
});

test("dropping the same grouped item twice creates two independent groups", async ({ page }) => {
  // Group ids are stored in the file and reused by every drop, so without a re-mint on insert the
  // second copy would join the first one's group — one click would then select and delete both.
  await openLibrary(page);
  await importFixture(page, LIBRARY_FILE);

  const item = page.getByTestId("library-item").first();
  await item.click();
  await item.click();
  expect(await liveElementCount(page)).toBe(6);

  await page.keyboard.press("Escape"); // closes the library panel
  await expect(page.getByTestId("library-panel")).toHaveCount(0);
  // Clear the selection the second drop left behind: a click *inside* a selected element's bounding
  // box grabs it to move rather than re-resolving what it hits.
  await page.mouse.click(450, 560);

  // Both copies land at the viewport center, so this click hits the topmost one; what it *expands*
  // to is the group behaviour under test.
  await page.mouse.click(640, 360);
  await page.keyboard.press("Delete");

  expect(await liveElementCount(page)).toBe(3);
});

test("a nested imported shape moves as one piece, not as the sub-group under the cursor", async ({ page }) => {
  // Published library shapes nest: an outer group holds the whole icon, inner groups hold clusters of
  // strokes inside it. Excalidraw writes `groupIds` innermost-first and this app reads it
  // outermost-first, so without the flip at import a click would resolve to the cluster it landed on
  // and drag that fragment out of the shape.
  const shape = (id: string, x: number, y: number, width: number, height: number, groupIds: string[]) =>
    ({ type: "rectangle", id, x, y, width, height, strokeColor: "#000000", backgroundColor: "#eeeeee", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 1, opacity: 100, angle: 0, seed: 1, groupIds, strokeSharpness: "sharp", boundElementIds: [] });
  const nested = [
    shape("body", 0, 0, 120, 120, ["shape"]),
    shape("blade-a", 40, 40, 40, 10, ["blades", "shape"]),
    shape("blade-b", 40, 70, 40, 10, ["blades", "shape"]),
    { ...shape("label", 0, 130, 120, 20, ["shape"]), type: "text", text: "Cold Storage", fontSize: 16, fontFamily: 1, textAlign: "center", verticalAlign: "top" },
  ];

  await openLibrary(page);
  await importFixture(page, { ...LIBRARY_FILE, library: [nested] });
  await page.getByTestId("library-item").first().click();
  expect(await liveElementCount(page)).toBe(4);

  await page.keyboard.press("Escape"); // closes the library panel
  await expect(page.getByTestId("library-panel")).toHaveCount(0);
  await page.mouse.click(300, 600); // clears the selection the drop left behind

  // The item is centered on the viewport, so its own (60, 45) — the middle of the upper blade, which
  // belongs to the *inner* group — sits 30px above the viewport center.
  await page.mouse.click(640, 330);
  await page.keyboard.press("Delete");

  // The whole shape goes, including the label, which shares only the outer group with the blade.
  expect(await liveElementCount(page)).toBe(0);
});

test("imported items are searchable by their labels, which is the only name a v1 library gives them", async ({ page }) => {
  // The v1 envelope has no field for an item name at all, so every item would otherwise be a
  // positional "Item 1"/"Item 2" and the search box could never match a word anyone would type.
  // The item carries a big title and a small annotation under it, the usual shape of a real diagram
  // shape — so this covers both halves: naming picks the title, and search still reaches the rest.
  const annotated = [
    ...GROUPED_ITEM,
    { type: "text", id: "t2", x: 10, y: 44, width: 100, height: 10, strokeColor: "#000000", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 1, opacity: 100, angle: 0, seed: 555, groupIds: ["src-group"], strokeSharpness: "sharp", boundElementIds: [], text: "us-east-1", fontSize: 8, fontFamily: 1, textAlign: "center", verticalAlign: "top" },
  ];
  await openLibrary(page);
  await importFixture(page, { ...LIBRARY_FILE, library: [annotated, LIBRARY_FILE.library[1]] });
  await expect(page.getByTestId("library-item")).toHaveCount(2);

  // Named after its largest label, not the first one in the file.
  await expect(page.getByTestId("library-item").first()).toHaveAttribute("aria-label", "Server");

  await page.getByTestId("library-search").fill("server");
  await expect(page.getByTestId("library-item")).toHaveCount(1);

  // The annotation is inside the item but is *not* its name — a name-only search would miss it.
  await page.getByTestId("library-search").fill("us-east");
  await expect(page.getByTestId("library-item")).toHaveCount(1);

  // The unlabelled diamond item has no text to match, and must not be swept in by a name it never had.
  await page.getByTestId("library-search").fill("diamond");
  await expect(page.getByTestId("library-item")).toHaveCount(0);
  await expect(page.getByTestId("library-no-results")).toBeVisible();
});

test("a file that is not a library is rejected by name, not silently imported as empty", async ({ page }) => {
  await openLibrary(page);
  // A valid `.excalidraw` *scene* — well-formed JSON, right vendor, wrong kind of file.
  await importFixture(page, { type: "excalidraw", version: 2, elements: [] }, "drawing.excalidraw");

  await expect(page.getByTestId("library-status")).toBeVisible();
  await expect(page.getByTestId("library-item")).toHaveCount(0);
});
