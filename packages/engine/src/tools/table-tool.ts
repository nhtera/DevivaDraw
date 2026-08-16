/**
 * Drag-to-create table tool. Hand-rolled on `NoOpToolHandler` (the frame-tool precedent) rather than
 * extending `DragShapeTool`: that base re-derives NOTHING on move/end — it raw-merges `{x,y,width,
 * height}` into the draft, and its gesture bookkeeping is private — while a table must keep
 * `columnWidths`/`rowHeights` tracking the rect on EVERY frame or the sum invariant
 * (`table-element.ts`) breaks mid-drag. Each frame rescales a pristine equal-split 3×3 grid into the
 * live drag rect (never compounding scale on the draft's own arrays), with `scaleTableGrid`'s min
 * clamps as the effective minimum drag size.
 *
 * A plain click (no drag) drops the default 360×120 table centered on the click — the same
 * click-to-place affordance the shape tools offer, at the table's own natural default size.
 */
import type { TableElement } from "../elements/table-element";
import { createTableElement, DEFAULT_TABLE_COLUMN_WIDTH, DEFAULT_TABLE_ROW_HEIGHT } from "../elements/table-element";
import { scaleTableGrid } from "../elements/table-layout";
import { NoOpToolHandler } from "../input/tool-handler";
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";
import type { Scene } from "../scene/scene";
import type { ShapeStyleState } from "./shape-style-state";
import type { ShapeToolHistory } from "./drag-shape-tool-base";
import type { DragRect } from "./shape-drag-geometry";
import { computeDragRect } from "./shape-drag-geometry";

export interface TableToolDeps {
  scene: Scene;
  styleState: ShapeStyleState;
  history: ShapeToolHistory;
  /** Called once a table is committed, with its id — see `drag-shape-tool-base.ts`'s `onCreated`. */
  onCreated?: (elementId: string) => void;
}

/** The pristine equal-split default grid every drag frame rescales FROM — never the draft's own (already-scaled) arrays, so repeated scaling can't compound. */
const DEFAULT_GRID = {
  columnWidths: Array.from({ length: 3 }, () => DEFAULT_TABLE_COLUMN_WIDTH),
  rowHeights: Array.from({ length: 3 }, () => DEFAULT_TABLE_ROW_HEIGHT),
};
const DEFAULT_CLICK_WIDTH = DEFAULT_TABLE_COLUMN_WIDTH * 3;
const DEFAULT_CLICK_HEIGHT = DEFAULT_TABLE_ROW_HEIGHT * 3;

export class TableTool extends NoOpToolHandler {
  private readonly deps: TableToolDeps;
  private startPoint: Point | null = null;
  private draftId: string | null = null;

  constructor(deps: TableToolDeps) {
    super();
    this.deps = deps;
  }

  /** The default grid rescaled into `rect` — equal thirds both ways, min-clamped, sums = width/height. */
  private gridFor(rect: DragRect): ReturnType<typeof scaleTableGrid> {
    return scaleTableGrid(DEFAULT_GRID, rect);
  }

  override onGestureStart(point: Point, modifiers: ModifierKeys): void {
    this.startPoint = point;
    this.deps.history.beginBatch();
    const rect = computeDragRect(point, point, modifiers);
    const grid = this.gridFor(rect);
    const element = createTableElement({
      x: grid.x,
      y: grid.y,
      ...this.deps.styleState.getStyle(),
      columnWidths: grid.columnWidths,
      rowHeights: grid.rowHeights,
    });
    this.draftId = this.deps.scene.addElement(element).id;
  }

  override onGestureMove(point: Point, modifiers: ModifierKeys): void {
    if (!this.startPoint || !this.draftId) return;
    const rect = computeDragRect(this.startPoint, point, modifiers);
    this.deps.scene.updateElement(this.draftId, this.gridFor(rect) as Partial<TableElement>);
  }

  override onGestureEnd(point: Point, modifiers: ModifierKeys): void {
    if (!this.startPoint || !this.draftId) return;
    const rect = computeDragRect(this.startPoint, point, modifiers);
    const finalRect =
      rect.width === 0 && rect.height === 0
        ? {
            x: this.startPoint.x - DEFAULT_CLICK_WIDTH / 2,
            y: this.startPoint.y - DEFAULT_CLICK_HEIGHT / 2,
            width: DEFAULT_CLICK_WIDTH,
            height: DEFAULT_CLICK_HEIGHT,
          }
        : rect;

    this.deps.scene.updateElement(this.draftId, this.gridFor(finalRect) as Partial<TableElement>);
    this.deps.history.endBatch(this.deps.scene.getElements());
    const createdId = this.draftId;
    this.reset();
    this.deps.onCreated?.(createdId);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `modifiers` kept to match `ToolHandler`'s signature
  override onGestureCancel(modifiers: ModifierKeys): void {
    // History cancellation for aborts is guaranteed by the input pipeline — see `drag-shape-tool-base.ts`.
    if (this.draftId) this.deps.scene.deleteElement(this.draftId);
    this.reset();
  }

  private reset(): void {
    this.startPoint = null;
    this.draftId = null;
  }
}
