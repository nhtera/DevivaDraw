/**
 * Column-boundary drag on a single selected table: resizes exactly one column, with every column to
 * its right shifting (the spreadsheet convention — total width changes, the columns beside the
 * boundary don't redistribute). A distinct gesture class rather than a `dispatchResize` case: that
 * dispatcher only ever receives whole-element bounds from a frame handle drag, while this gesture
 * owns one interior boundary. Same frozen-original + own-history-batch contract as the sibling
 * gesture classes (`selection-resize-gesture.ts` et al).
 *
 * Text re-fit runs once at `finish()` (through the same deps measurer the resize gesture uses),
 * never per-frame — the plan's drag-perf decision; mid-drag a narrowed column may clip its text.
 */
import type { TableElement } from "../elements/table-element";
import { fitRowHeightsToText, MIN_COLUMN_WIDTH, tableColumnWidths } from "../elements/table-layout";
import type { Point } from "../render/camera";
import { rotatePointAroundCenter } from "./selection-geometry";
import type { SelectionToolDeps } from "./selection-tool-deps";

export class TableColumnResizeGesture {
  private readonly deps: SelectionToolDeps;
  private elementId: string | null = null;
  private boundaryIndex = 0;
  private startLocalX = 0;
  private originalColumnWidths: number[] | null = null;
  private originalWidth = 0;
  private changed = false;
  /** The table's center + angle FROZEN at begin: resizing moves the live center (width changes shift it), so converting mid-drag pointers against the live element would double-count the delta on a rotated table. Everything maps into the ORIGINAL local frame, matching the frozen original widths. */
  private frozenCenter: Point = { x: 0, y: 0 };
  private frozenAngle = 0;
  private frozenOriginX = 0;

  constructor(deps: SelectionToolDeps) {
    this.deps = deps;
  }

  begin(element: TableElement, boundaryIndex: number, startScenePoint: Point): void {
    this.elementId = element.id;
    this.boundaryIndex = boundaryIndex;
    this.frozenCenter = { x: element.x + element.width / 2, y: element.y + element.height / 2 };
    this.frozenAngle = element.angle;
    this.frozenOriginX = element.x;
    this.startLocalX = this.toLocalX(startScenePoint);
    this.originalColumnWidths = tableColumnWidths(element);
    this.originalWidth = element.width;
    this.changed = false;
    this.deps.history.beginBatch();
  }

  /** Scene point → x in the FROZEN original local frame (see the field doc). */
  private toLocalX(point: Point): number {
    return rotatePointAroundCenter(point, this.frozenCenter, -this.frozenAngle).x - this.frozenOriginX;
  }

  /** Applies the drag at scene point `point` — recomputed from the frozen originals every call, so repeated applies for the same pointer position are idempotent. */
  apply(point: Point): void {
    const localX = this.toLocalX(point);
    if (!this.elementId || !this.originalColumnWidths) return;
    const delta = localX - this.startLocalX;
    const original = this.originalColumnWidths;
    const resized = Math.max(MIN_COLUMN_WIDTH, (original[this.boundaryIndex] ?? MIN_COLUMN_WIDTH) + delta);
    const columnWidths = original.map((width, index) => (index === this.boundaryIndex ? resized : width));
    const width = columnWidths.reduce((total, value) => total + value, 0);
    this.changed = this.changed || width !== this.originalWidth;
    this.deps.scene.updateElement(this.elementId, { columnWidths, width } as Partial<TableElement>);
  }

  finish(): void {
    if (!this.elementId) return;
    if (!this.changed) {
      this.deps.history.cancelBatch();
      this.reset();
      return;
    }
    // Re-wrap the (now narrower/wider) columns' text and grow/shrink rows once, inside the same
    // batch, so drag + re-fit undo as one step — the resize-gesture precedent.
    const element = this.deps.scene.getElement(this.elementId);
    if (element && element.type === "table" && this.deps.textMeasurer) {
      const fit = fitRowHeightsToText(element, this.deps.textMeasurer);
      if (fit) this.deps.scene.updateElement(this.elementId, fit as Partial<TableElement>);
    }
    this.deps.history.endBatch(this.deps.scene.getElements());
    this.reset();
  }

  cancel(): void {
    if (this.elementId && this.originalColumnWidths) {
      this.deps.scene.updateElement(this.elementId, { columnWidths: this.originalColumnWidths, width: this.originalWidth } as Partial<TableElement>);
    }
    this.reset();
  }

  private reset(): void {
    this.elementId = null;
    this.originalColumnWidths = null;
    this.changed = false;
  }
}
