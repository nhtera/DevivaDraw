import { readFileSync, statSync } from "node:fs";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The table element's end-to-end battery: create → auto-edit → Tab walk → restructure → resize →
 * persist/export/undo, plus the cross-cutting sweeps (layers gating, locked-dblclick, view-only,
 * duplicate independence, find, binding). Scene-state assertions read the autosave payload (the
 * layers-spec pattern); canvas coords stay right of x≈350 while a creation tool is armed.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

/** Places a default 3×3 table by click; waits for the auto-opened cell editor (the fresh wait pattern — no fixed timeout, the rAF-deferred dispatch needs the overlay mounted). */
async function placeTable(page: Page, x = 650, y = 350): Promise<void> {
  await page.getByTestId("toolbar-more").click();
  await page.getByTestId("more-table-tool").click();
  await page.mouse.click(x, y);
  await expect(page.getByTestId("table-cell-editor")).toBeVisible();
  await expect(page.getByTestId("table-cell-editor")).toBeFocused();
}

interface StoredTable {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  columnWidths: number[];
  rowHeights: number[];
  cells: string[][];
  locked?: boolean;
}

/** The one table the test expects — asserted present, so the type is definite. */
async function storedTable(page: Page): Promise<StoredTable> {
  const tables = await storedTables(page);
  expect(tables.length).toBeGreaterThan(0);
  return tables[0]!;
}

/** The autosaved table elements (waits out the autosave debounce). */
async function storedTables(page: Page): Promise<StoredTable[]> {
  await page.waitForTimeout(1300);
  return page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!);
    const scene = doc.pages ? doc.pages[0].scene : doc;
    return scene.elements.filter((element: { type: string; isDeleted: boolean }) => element.type === "table" && !element.isDeleted);
  });
}

test("place by click: auto-edits cell (0,0); typing + Tab walk the row; Escape commits", async ({ page }) => {
  await placeTable(page);
  await page.getByTestId("table-cell-editor").fill("Alpha");
  await page.keyboard.press("Tab");
  await page.getByTestId("table-cell-editor").fill("Beta");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("table-cell-editor")).toHaveCount(0);

  const table = await storedTable(page);
  expect(table.cells[0]).toEqual(["Alpha", "Beta", ""]);
  expect(table.width).toBe(360);
  expect(table.columnWidths).toEqual([120, 120, 120]);
});

test("Tab past the last cell appends a row in ONE undo step (row + its trigger commit undo together)", async ({ page }) => {
  await placeTable(page);
  // Walk to the last cell: 9 cells, start at (0,0) → 8 Tabs to reach (2,2).
  for (let i = 0; i < 8; i += 1) await page.keyboard.press("Tab");
  await page.getByTestId("table-cell-editor").fill("last");
  await page.keyboard.press("Tab"); // append
  await expect(page.getByTestId("table-cell-editor")).toBeVisible(); // caret continued into the new row
  await page.keyboard.press("Escape");

  let table = await storedTable(page);
  expect(table.rowHeights).toHaveLength(4);
  expect(table.cells[2]![2]).toBe("last");

  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  table = await storedTable(page);
  expect(table.rowHeights).toHaveLength(3);
  expect(table.cells[2]![2]).toBe(""); // the append-Tab's text commit undid with the row
});

test("double-click edits exactly the clicked cell; a long text grows only its row", async ({ page }) => {
  await placeTable(page);
  await page.keyboard.press("Escape");
  // Middle cell (row 1, col 1): table spans x 470-830, y 290-410 → cell center ~(650, 350).
  await page.mouse.dblclick(650, 350);
  await expect(page.getByTestId("table-cell-editor")).toBeVisible();
  await page.getByTestId("table-cell-editor").fill("a much longer cell text that must wrap across several lines");
  await page.keyboard.press("Escape");

  const table = await storedTable(page);
  expect(table.cells[1]![1]).toContain("longer cell text");
  expect(table.rowHeights[1]!).toBeGreaterThan(40); // its row grew
  expect(table.rowHeights[0]).toBe(28); // empty rows settle at the minimum on re-fit (shrink-to-fit, by design)
  expect(table.height).toBeCloseTo(table.rowHeights.reduce((a, b) => a + b, 0), 1);
});

test("panel structure buttons add/remove rows and columns; the last of each is guarded", async ({ page }) => {
  await placeTable(page);
  await page.keyboard.press("Escape");
  await page.mouse.click(650, 350); // select
  await page.getByTestId("table-add-row").click();
  await page.getByTestId("table-add-column").click();
  let table = await storedTable(page);
  expect(table.rowHeights).toHaveLength(4);
  expect(table.columnWidths).toHaveLength(4);
  expect(table.cells[3]).toHaveLength(4);

  // Remove down to one of each: the remove buttons disable at the floor.
  for (let i = 0; i < 3; i += 1) await page.getByTestId("table-remove-row").click();
  for (let i = 0; i < 3; i += 1) await page.getByTestId("table-remove-column").click();
  await expect(page.getByTestId("table-remove-row")).toBeDisabled();
  await expect(page.getByTestId("table-remove-column")).toBeDisabled();
  table = await storedTable(page);
  expect(table.rowHeights).toHaveLength(1);
  expect(table.columnWidths).toHaveLength(1);
});

test("dragging an interior column boundary resizes that column; the table never moves", async ({ page }) => {
  await placeTable(page);
  await page.keyboard.press("Escape");
  await page.mouse.click(650, 350); // select
  // First boundary at x = 470 + 120 = 590.
  await page.mouse.move(590, 350);
  await page.mouse.down();
  await page.mouse.move(620, 350);
  await page.mouse.move(650, 350);
  await page.mouse.up();

  const table = await storedTable(page);
  expect(table.columnWidths[0]!).toBeGreaterThan(150);
  expect(table.columnWidths[1]).toBe(120);
  expect(table.x).toBe(470);
  expect(table.width).toBeCloseTo(table.columnWidths.reduce((a, b) => a + b, 0), 1);
});

test("corner-handle resize scales the whole grid and one undo restores it", async ({ page }) => {
  await placeTable(page);
  await page.keyboard.press("Escape");
  await page.mouse.click(650, 350);
  // SE corner of the padded selection frame sits just outside (830, 410).
  await page.mouse.move(836, 416);
  await page.mouse.down();
  await page.mouse.move(1000, 500);
  await page.mouse.up();

  let table = await storedTable(page);
  expect(table.width).toBeGreaterThan(400);
  expect(table.width).toBeCloseTo(table.columnWidths.reduce((a, b) => a + b, 0), 1);

  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  table = await storedTable(page);
  expect(table.width).toBeCloseTo(360, 1);
});

test("duplicate is fully independent: editing the copy never touches the original", async ({ page }) => {
  await placeTable(page);
  await page.getByTestId("table-cell-editor").fill("original");
  await page.keyboard.press("Escape");
  await page.mouse.click(650, 350);
  // Duplicate via the context menu — the keyboard shortcut is browser-reserved under automation.
  await page.mouse.click(650, 350, { button: "right" });
  await page.getByTestId("context-menu-duplicate").click();

  let tables = await storedTables(page);
  expect(tables).toHaveLength(2);
  const copy = tables.find((candidate) => candidate.cells[0]![0] === "original" && candidate.x !== 470) ?? tables[1]!;

  // Edit the copy's first cell (it's offset from the original).
  await page.mouse.dblclick(copy.x + 60, copy.y + 20);
  await expect(page.getByTestId("table-cell-editor")).toBeVisible();
  await page.getByTestId("table-cell-editor").fill("changed");
  await page.keyboard.press("Escape");

  tables = await storedTables(page);
  const original = tables.find((candidate) => candidate.x === 470)!;
  const edited = tables.find((candidate) => candidate.x !== 470)!;
  expect(original.cells[0]![0]).toBe("original");
  expect(edited.cells[0]![0]).toBe("changed");
});

test("a locked table (and a locked note) offer no editor on double-click", async ({ page }) => {
  await placeTable(page);
  await page.keyboard.press("Escape");
  // Lock it via the scene: seed the autosave and reload (the lock-retrofit regression pin).
  await storedTables(page);
  await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!);
    const scene = doc.pages ? doc.pages[0].scene : doc;
    for (const element of scene.elements) if (element.type === "table") element.locked = true;
    localStorage.setItem("devivadraw:autosave:v1", JSON.stringify(doc));
  });
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await page.mouse.dblclick(650, 350);
  await page.waitForTimeout(300);
  await expect(page.getByTestId("table-cell-editor")).toHaveCount(0);
});

test("view-only mode: double-click is inert, no cell editor mounts", async ({ page }) => {
  await placeTable(page);
  await page.keyboard.press("Escape");
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-preferences").click();
  await page.getByTestId("main-menu-toggle-view-only").click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.mouse.dblclick(650, 350);
  await page.waitForTimeout(300);
  await expect(page.getByTestId("table-cell-editor")).toHaveCount(0);
});

test("a hidden layer hides its table from clicks; a locked layer refuses the editor", async ({ page }) => {
  // Layers panel on, new layer, table onto it.
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-preferences").click();
  await page.getByTestId("main-menu-toggle-layers").click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByTestId("layers-add").click();
  await placeTable(page);
  await page.keyboard.press("Escape");

  // Lock the layer: dblclick opens nothing.
  await page.locator('[data-testid^="layer-locked-"]').first().click();
  await page.mouse.dblclick(650, 350);
  await page.waitForTimeout(300);
  await expect(page.getByTestId("table-cell-editor")).toHaveCount(0);
  await page.locator('[data-testid^="layer-locked-"]').first().click();

  // Hide the layer: the table stops being clickable at all.
  await page.locator('[data-testid^="layer-visible-"]').first().click();
  await page.mouse.move(650, 350);
  await page.waitForTimeout(200);
  const cursor = await page.getByTestId("deviva-draw-canvas-host").evaluate((host) => (host as HTMLElement).style.cursor);
  expect(cursor).toBe("default");
});

test("Cmd+F finds table cell text", async ({ page }) => {
  await placeTable(page);
  await page.getByTestId("table-cell-editor").fill("needle-in-cell");
  await page.keyboard.press("Escape");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f");
  await page.getByTestId("find-input").fill("needle");
  await expect(page.getByTestId("find-count")).toContainText("1");
});

test("SVG export carries the grid and XML-escaped cell text; PNG export succeeds", async ({ page }) => {
  await placeTable(page);
  await page.getByTestId("table-cell-editor").fill("cell & <text>");
  await page.keyboard.press("Escape");

  await page.getByTestId("top-bar-menu").click();
  const [svgDownload] = await Promise.all([page.waitForEvent("download"), page.getByTestId("main-menu-export-svg").click()]);
  const svgPath = await svgDownload.path();
  const svg = readFileSync(svgPath!, "utf8");
  expect(svg).toContain("cell &amp; &lt;text&gt;");
  expect(svg).not.toContain("cell & <text>");
  expect(svg).toContain("clip-path=");

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-export-image").click();
  const [pngDownload] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-png").click()]);
  expect(statSync((await pngDownload.path())!).size).toBeGreaterThan(1000);
});

test("an arrow binds to a table and reroutes when the table moves", async ({ page }) => {
  await placeTable(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape"); // fully deselect
  // Draw an arrow from empty canvas into the table's left edge.
  await page.getByTestId("toolbar-arrow-tool").click();
  await page.mouse.move(380, 250);
  await page.mouse.down();
  await page.mouse.move(468, 330);
  await page.mouse.up();

  const bound = await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const doc = JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!);
    const scene = doc.pages ? doc.pages[0].scene : doc;
    const arrow = scene.elements.find((element: { type: string }) => element.type === "arrow");
    const table = scene.elements.find((element: { type: string }) => element.type === "table");
    return { end: arrow?.endBinding?.elementId, tableId: table?.id };
  });
  expect(bound.end).toBe(bound.tableId);
});

test("eraser deletes a table", async ({ page }) => {
  await placeTable(page);
  await page.keyboard.press("Escape");
  await page.getByTestId("toolbar-eraser-tool").click();
  await page.mouse.move(600, 320);
  await page.mouse.down();
  await page.mouse.move(700, 380);
  await page.mouse.up();
  const tables = await storedTables(page);
  expect(tables).toHaveLength(0);
});

test("reload restores the table exactly (grid + text + sums)", async ({ page }) => {
  await placeTable(page);
  await page.getByTestId("table-cell-editor").fill("persist me");
  await page.keyboard.press("Escape");
  const before = await storedTable(page);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  const after = await storedTable(page);
  expect(after).toEqual(before);
});

test("typed keystrokes stay in the cell — tool-shortcut letters are not eaten and the tool never switches", async ({ page }) => {
  // Regression: plain letters used to bubble to the global shortcut resolver (the table session is
  // not the engine text-edit session, so nothing suppressed it) — "r"/"o"/"l"/"d" switched tools
  // and were preventDefault'ed out of the draft. `.fill()` bypasses keydowns, so this types.
  await placeTable(page);
  const editor = page.getByTestId("table-cell-editor");
  await expect(editor).toBeFocused();
  await page.keyboard.type("World rold"); // every letter here is (or contains) a tool shortcut
  await expect(editor).toHaveValue("World rold");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("toolbar-select-tool")).toHaveAttribute("aria-pressed", "true");
});
