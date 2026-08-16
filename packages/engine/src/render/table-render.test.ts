/**
 * Table rendering: the rough grid path geometry, the version-keyed wrapped-text layout cache, and
 * the per-cell clipped text painter — including the defensive-render contract (a collab-ingested
 * malformed grid must paint as nothing, never throw mid-frame).
 */
import { describe, expect, it, vi } from "vitest";
import { createTableElement } from "../elements/table-element";
import type { TableElement } from "../elements/table-element";
import { TABLE_CELL_PADDING } from "../elements/table-layout";
import { createFixedWidthTextMeasurer } from "../text/text-measurement";
import type { Camera } from "./camera";
import { tablePath } from "./rough-shape-geometry";
import { layoutTableText, TableTextLayoutCache } from "./table-text-layout-cache";
import { drawTableCellText } from "./table-text-renderer";
import type { TableTextDrawContext2D } from "./table-text-renderer";

const CAMERA: Camera = { scrollX: 0, scrollY: 0, zoom: 1 };

function seededTable(cells?: string[][]): TableElement {
  return createTableElement({ x: 10, y: 20, columnWidths: [100, 60], rowHeights: [30, 50], cells: cells ?? [["alpha", ""], ["", "beta"]] });
}

function fakeCtx(): TableTextDrawContext2D & { fillTextCalls: [string, number, number][]; clip: ReturnType<typeof vi.fn> } {
  const fillTextCalls: [string, number, number][] = [];
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    globalAlpha: 1,
    fillStyle: "",
    font: "",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
    fillText: (text: string, x: number, y: number) => void fillTextCalls.push([text, x, y]),
    measureText: (text: string) => ({ width: text.length * 10 }),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillTextCalls,
  };
}

describe("tablePath", () => {
  it("emits the outer rect plus one open segment per interior boundary", () => {
    const path = tablePath({ x: 0, y: 0, width: 160, height: 80 }, [100], [30]);
    expect(path).toBe("M 0 0 H 160 V 80 H 0 Z M 100 0 V 80 M 0 30 H 160");
  });

  it("a 1×1 grid is just the rect (no interior lines)", () => {
    expect(tablePath({ x: 5, y: 5, width: 50, height: 40 }, [], [])).toBe("M 5 5 H 55 V 45 H 5 Z");
  });
});

describe("TableTextLayoutCache", () => {
  const measurer = createFixedWidthTextMeasurer(10);

  it("wraps at scene font size, caches by version, and recomputes only on version change", () => {
    const cache = new TableTextLayoutCache();
    const el = { ...seededTable(), version: 3 };
    const first = cache.get(el, measurer);
    expect(first.cellLines[0]![0]).toEqual(["alpha"]);
    expect(cache.get(el, measurer)).toBe(first); // same version → same object, no rewrap
    const edited = { ...el, cells: [["changed", ""], ["", "beta"]], version: 4 };
    const second = cache.get(edited, measurer);
    expect(second).not.toBe(first);
    expect(second.cellLines[0]![0]).toEqual(["changed"]);
  });

  it("prunes entries for ids no longer live", () => {
    const cache = new TableTextLayoutCache();
    const el = seededTable();
    cache.get(el, measurer);
    cache.prune(new Set<string>());
    const again = cache.get(el, measurer);
    expect(again).toBeTruthy(); // recomputed fresh after prune (no stale entry returned)
  });

  it("a malformed grid lays out as empty lists instead of throwing", () => {
    const hostile = { ...seededTable(), cells: "hostile" } as unknown as TableElement;
    expect(() => layoutTableText(hostile, measurer)).not.toThrow();
    const layout = layoutTableText(hostile, measurer);
    expect(layout.cellLines.flat().every((lines) => lines.length === 0)).toBe(true);
  });
});

describe("drawTableCellText", () => {
  const measurer = createFixedWidthTextMeasurer(10);

  it("paints non-empty cells clipped to their cell rect, offset by the element position", () => {
    const ctx = fakeCtx();
    drawTableCellText(ctx, seededTable(), CAMERA, measurer);
    // Two non-empty cells → two clip regions, two painted lines.
    expect(ctx.clip).toHaveBeenCalledTimes(2);
    expect(ctx.fillTextCalls.map(([text]) => text)).toEqual(["alpha", "beta"]);
    // "alpha" sits in cell (0,0): x = el.x + 0 + padding, top starts at el.y + padding.
    const [, x, y] = ctx.fillTextCalls[0]!;
    expect(x).toBe(10 + TABLE_CELL_PADDING);
    expect(y).toBeGreaterThan(20 + TABLE_CELL_PADDING);
    // "beta" sits in cell (1,1): x = el.x + 100 + padding, y below the first row (30 tall).
    expect(ctx.fillTextCalls[1]![1]).toBe(10 + 100 + TABLE_CELL_PADDING);
    expect(ctx.fillTextCalls[1]![2]).toBeGreaterThan(20 + 30);
  });

  it("zoom scales positions and font, but the wrap (cached at scene size) is zoom-independent", () => {
    const cache = new TableTextLayoutCache();
    const el = { ...seededTable([["a".repeat(20), ""], ["", ""]]), version: 7 };
    const at1 = cache.get(el, measurer);
    const ctx = fakeCtx();
    drawTableCellText(ctx, el, { scrollX: 0, scrollY: 0, zoom: 2 }, measurer, cache);
    expect(cache.get(el, measurer)).toBe(at1); // zoom change did not invalidate
    expect(ctx.font).toContain("40px"); // 20 scene px × zoom 2
    expect(ctx.fillTextCalls[0]![1]).toBe(10 * 2 + TABLE_CELL_PADDING * 2); // screen x scales with zoom
  });

  it("a fully-empty table paints nothing; a hostile grid never throws", () => {
    const ctx = fakeCtx();
    drawTableCellText(ctx, seededTable([["", ""], ["", ""]]), CAMERA, measurer);
    expect(ctx.fillTextCalls).toHaveLength(0);
    const hostile = { ...seededTable(), cells: [null] } as unknown as TableElement;
    expect(() => drawTableCellText(fakeCtx(), hostile, CAMERA, measurer)).not.toThrow();
  });

  it("a rotated table wraps the paint in its own translate/rotate around the element center", () => {
    const ctx = fakeCtx();
    drawTableCellText(ctx, { ...seededTable(), angle: Math.PI / 4 }, CAMERA, measurer);
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 4);
    expect(ctx.translate).toHaveBeenCalledTimes(2); // center in, center out
  });
});

describe("buildElementDrawable — table grid integration", () => {
  it("routes a real table through tablePath with zoom-scaled interior offsets", async () => {
    const { buildElementDrawable } = await import("./rough-renderer");
    const el = seededTable(); // at (10,20), columns [100,60], rows [30,50]
    const paths: string[] = [];
    const drawer = { path: (d: string) => (paths.push(d), { shape: "path" }), rectangle: vi.fn(), ellipse: vi.fn(), polygon: vi.fn(), linearPath: vi.fn() };
    buildElementDrawable(drawer as never, el, { scrollX: 0, scrollY: 0, zoom: 2 });
    expect(paths).toHaveLength(1);
    // Interior boundaries only: one vertical at 100*2, one horizontal at 30*2, relative to origin (20,40).
    expect(paths[0]).toContain("M 220 40 V 200"); // 20 + 200px vertical line
    expect(paths[0]).toContain("M 20 100 H 340"); // horizontal at 40 + 60px
  });

  it("a hostile grid never throws in the rough path either", async () => {
    const { buildElementDrawable } = await import("./rough-renderer");
    const hostile = { ...seededTable(), columnWidths: "nope", rowHeights: [null] } as unknown as TableElement;
    const drawer = { path: vi.fn(() => ({ shape: "path" })), rectangle: vi.fn(), ellipse: vi.fn(), polygon: vi.fn(), linearPath: vi.fn() };
    expect(() => buildElementDrawable(drawer as never, hostile, CAMERA)).not.toThrow();
  });
});
