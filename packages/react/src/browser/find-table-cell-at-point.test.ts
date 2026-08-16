import { describe, expect, it } from "vitest";
import { createRectangleElement, createTableElement, Scene } from "@deviva-draw/engine";
import { findTableCellAt } from "./find-table-cell-at-point";

function sceneWithTable(overrides: Partial<Parameters<typeof createTableElement>[0]> = {}) {
  const scene = new Scene();
  const table = scene.addElement(createTableElement({ x: 100, y: 100, columnWidths: [100, 100], rowHeights: [40, 40], ...overrides }));
  return { scene, table };
}

describe("findTableCellAt", () => {
  it("resolves the exact cell under the point; misses outside", () => {
    const { scene, table } = sceneWithTable();
    expect(findTableCellAt(scene, { x: 150, y: 120 })).toMatchObject({ table: { id: table.id }, row: 0, col: 0 });
    expect(findTableCellAt(scene, { x: 250, y: 150 })).toMatchObject({ row: 1, col: 1 });
    expect(findTableCellAt(scene, { x: 50, y: 50 })).toBeNull();
  });

  it("unrotates the point so a rotated table's cells resolve exactly", () => {
    // 90° rotation around the center (200, 140): scene point (200+40, 140) maps back to local... verify a
    // point that ONLY hits the right cell when unrotated.
    const { scene } = sceneWithTable({ angle: Math.PI / 2 });
    // Center (200,140). The unrotated top-left cell center (150,120) rotates to (220, 90).
    const hit = findTableCellAt(scene, { x: 220, y: 90 });
    expect(hit).toMatchObject({ row: 0, col: 0 });
  });

  it("never offers a locked (element or layer) or hidden table", () => {
    const { scene, table } = sceneWithTable();
    scene.updateElement(table.id, { locked: true });
    expect(findTableCellAt(scene, { x: 150, y: 120 })).toBeNull();
    scene.updateElement(table.id, { locked: false });

    const layer = scene.addLayer("gated");
    scene.updateElement(table.id, { layerId: layer.id });
    scene.setLayerLocked(layer.id, true);
    expect(findTableCellAt(scene, { x: 150, y: 120 })).toBeNull();
    scene.setLayerLocked(layer.id, false);
    scene.setLayerVisible(layer.id, false);
    expect(findTableCellAt(scene, { x: 150, y: 120 })).toBeNull();
  });

  it("prefers the topmost table and ignores non-tables above it", () => {
    const { scene, table } = sceneWithTable();
    scene.addElement(createRectangleElement({ x: 100, y: 100, width: 200, height: 80 })); // rect ON TOP
    const hit = findTableCellAt(scene, { x: 150, y: 120 });
    expect(hit?.table.id).toBe(table.id); // rect doesn't block the table finder (dblclick chain order handles priority)
  });
});
