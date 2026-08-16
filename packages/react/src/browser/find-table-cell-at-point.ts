/**
 * "Which table cell is under this scene-space point" — the double-click-to-edit hit test for tables.
 * Unlike the sibling finders (which ignore rotation as safe over-inclusion), this one UNROTATES the
 * point: cell resolution must be exact or the wrong cell opens. Locked (element- or layer-level,
 * via `effectiveLocked`) and hidden tables never offer editing — the lock check the older finders
 * originally shipped without.
 */
import type { Point, Scene, TableElement } from "@deviva-draw/engine";
import { elementCenter, rotatePointAroundCenter, tableCellAtPoint } from "@deviva-draw/engine";

export interface TableCellHit {
  table: TableElement;
  row: number;
  col: number;
}

/** Topmost editable table whose (unrotated) grid contains `point`, resolved to the exact cell — or `null`. */
export function findTableCellAt(scene: Scene, point: Point): TableCellHit | null {
  const elements = scene.getElements();
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i];
    if (!element || element.isDeleted || element.type !== "table" || scene.isElementHidden(element) || scene.effectiveLocked(element)) continue;
    const local = rotatePointAroundCenter(point, elementCenter(element), -element.angle);
    const cell = tableCellAtPoint(element, local.x - element.x, local.y - element.y);
    if (cell) return { table: element, row: cell.row, col: cell.col };
  }
  return null;
}
