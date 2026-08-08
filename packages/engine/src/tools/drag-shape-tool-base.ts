/**
 * Shared drag-to-create gesture for the single-drag shape tools (rectangle/ellipse/diamond). A
 * "draft" element is added to the scene at gesture start and resized live via `Scene.updateElement`
 * on every move, so the same rough.js renderer that draws committed shapes also draws the
 * in-progress drag — no separate preview layer needed. Concrete tools only implement `buildElement`.
 *
 * The seed is set once by the element factory inside `buildElement` at `onGestureStart` and never
 * touched again by this class's `updateElement` calls (they only ever pass `x/y/width/height`), so
 * the sketchy look never "re-rolls" mid-drag — matching `elements/base-element.ts`'s seed-stability
 * contract.
 */
import type { AnyElement } from "../elements/element-types";
import { NoOpToolHandler } from "../input/tool-handler";
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";
import type { Scene } from "../scene/scene";
import type { DragRect } from "./shape-drag-geometry";
import { computeDragRect } from "./shape-drag-geometry";
import type { ShapeStyle, ShapeStyleState } from "./shape-style-state";

/**
 * Structural subset of `HistoryStack<AnyElement[]>` the shape tools need (see
 * `history/history-stack.ts`) — kept narrow so tests can supply a plain fake instead of a real
 * `HistoryStack` instance.
 */
export interface ShapeToolHistory {
  beginBatch(): void;
  endBatch(snapshot: AnyElement[]): void;
  cancelBatch(): void;
}

export interface DragShapeToolDeps {
  scene: Scene;
  styleState: ShapeStyleState;
  history: ShapeToolHistory;
}

export abstract class DragShapeTool extends NoOpToolHandler {
  private readonly deps: DragShapeToolDeps;
  private startPoint: Point | null = null;
  private draftId: string | null = null;

  constructor(deps: DragShapeToolDeps) {
    super();
    this.deps = deps;
  }

  /** Builds the concrete element for this tool's shape type from the current drag rect + style. */
  protected abstract buildElement(rect: DragRect, style: ShapeStyle): AnyElement;

  override onGestureStart(point: Point, modifiers: ModifierKeys): void {
    this.startPoint = point;
    this.deps.history.beginBatch();
    const rect = computeDragRect(point, point, modifiers);
    const element = this.buildElement(rect, this.deps.styleState.getStyle());
    this.draftId = this.deps.scene.addElement(element).id;
  }

  override onGestureMove(point: Point, modifiers: ModifierKeys): void {
    if (!this.startPoint || !this.draftId) return;
    this.deps.scene.updateElement(this.draftId, computeDragRect(this.startPoint, point, modifiers));
  }

  override onGestureEnd(point: Point, modifiers: ModifierKeys): void {
    if (!this.startPoint || !this.draftId) return;
    const rect = computeDragRect(this.startPoint, point, modifiers);

    // A plain click (no drag distance at all) has nothing to commit: discard the draft and cancel
    // the batch this gesture opened, rather than leaving a zero-size, invisible element behind with
    // its own undo entry.
    if (rect.width === 0 && rect.height === 0) {
      this.deps.scene.deleteElement(this.draftId);
      this.deps.history.cancelBatch();
      this.reset();
      return;
    }

    this.deps.scene.updateElement(this.draftId, rect);
    this.deps.history.endBatch(this.deps.scene.getElements());
    this.reset();
  }

  /* eslint-disable @typescript-eslint/no-unused-vars -- `modifiers` kept to match `ToolHandler`'s signature */
  override onGestureCancel(modifiers: ModifierKeys): void {
    // No `history.cancelBatch()` here: the input pipeline already guarantees that for every abort
    // path (Escape mid-drag, pointercancel, blur) — see `input/pointer-event-pipeline.ts`. This only
    // has to undo the Scene side: soft-delete the draft so an aborted drag leaves no live element.
    if (this.draftId) this.deps.scene.deleteElement(this.draftId);
    this.reset();
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */

  private reset(): void {
    this.startPoint = null;
    this.draftId = null;
  }
}
