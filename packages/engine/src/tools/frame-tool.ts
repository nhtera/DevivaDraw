/**
 * Drag-to-create frame tool. Mirrors the shape tools' gesture contract (`drag-shape-tool-base.ts`):
 * a draft frame is added at gesture start and resized live, committed as one history batch on release,
 * and soft-deleted if the gesture aborts. Kept as its own handler rather than a `DragShapeTool`
 * subclass because a frame needs two things the shape base doesn't provide: a scene-derived default
 * name (`"Frame N"`, numbered by how many frames already exist) and no dependence on the shared shape
 * style state (a frame's look is fixed chrome).
 *
 * A plain click (no drag) drops a default-sized frame centered on the click, the same click-to-place
 * affordance the shape tools offer.
 */
import type { FrameElement } from "../elements/frame-element";
import { createFrameElement } from "../elements/frame-element";
import { NoOpToolHandler } from "../input/tool-handler";
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";
import type { Scene } from "../scene/scene";
import type { ShapeToolHistory } from "./drag-shape-tool-base";
import { computeDragRect } from "./shape-drag-geometry";

/** Side length of the frame a plain click (no drag) drops. */
const DEFAULT_CLICK_FRAME_SIZE = 300;

export interface FrameToolDeps {
  scene: Scene;
  history: ShapeToolHistory;
  /** Called once a frame is committed, with its id — see `drag-shape-tool-base.ts`'s `onCreated`. */
  onCreated?: (elementId: string) => void;
}

export class FrameTool extends NoOpToolHandler {
  private readonly deps: FrameToolDeps;
  private startPoint: Point | null = null;
  private draftId: string | null = null;

  constructor(deps: FrameToolDeps) {
    super();
    this.deps = deps;
  }

  /** `"Frame N"` where N is one past the current frame count — a stable, human-readable default name. */
  private nextFrameName(): string {
    const count = this.deps.scene.getElements().filter((element) => !element.isDeleted && element.type === "frame").length;
    return `Frame ${count + 1}`;
  }

  override onGestureStart(point: Point, modifiers: ModifierKeys): void {
    this.startPoint = point;
    this.deps.history.beginBatch();
    const rect = computeDragRect(point, point, modifiers);
    const frame: FrameElement = createFrameElement({ ...rect, name: this.nextFrameName() });
    this.draftId = this.deps.scene.addElement(frame).id;
  }

  override onGestureMove(point: Point, modifiers: ModifierKeys): void {
    if (!this.startPoint || !this.draftId) return;
    this.deps.scene.updateElement(this.draftId, computeDragRect(this.startPoint, point, modifiers));
  }

  override onGestureEnd(point: Point, modifiers: ModifierKeys): void {
    if (!this.startPoint || !this.draftId) return;
    const rect = computeDragRect(this.startPoint, point, modifiers);
    const finalRect =
      rect.width === 0 && rect.height === 0
        ? {
            x: this.startPoint.x - DEFAULT_CLICK_FRAME_SIZE / 2,
            y: this.startPoint.y - DEFAULT_CLICK_FRAME_SIZE / 2,
            width: DEFAULT_CLICK_FRAME_SIZE,
            height: DEFAULT_CLICK_FRAME_SIZE,
          }
        : rect;

    this.deps.scene.updateElement(this.draftId, finalRect);
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
