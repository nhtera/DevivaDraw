/**
 * Eraser tool: drag over elements to delete them, the same affordance Excalidraw/tldraw expose. The
 * whole erase-drag is one history batch ("one drag = one undo step", matching every drag-to-create
 * tool), so a swipe that removes several elements undoes in a single step. Deletes are soft (see
 * `Scene.deleteElement`), so undo restores them.
 *
 * Unlike the creation tools this never calls an `onCreated` hook — erasing doesn't hand back to the
 * select tool, so you can keep swiping to erase more (Escape/switch tools to stop).
 */
import { NoOpToolHandler } from "../input/tool-handler";
import type { Point } from "../render/camera";
import type { Scene } from "../scene/scene";
import { topmostElementAt } from "../selection/hit-test";
import type { ShapeToolHistory } from "./drag-shape-tool-base";

export interface EraserToolDeps {
  scene: Scene;
  history: ShapeToolHistory;
  /** Current camera zoom — the pointer hit tolerance is a screen-pixel value converted to scene units via this, so erasing feels equally forgiving at every zoom (same reasoning as `line-tool.ts`'s `getZoom`). */
  getZoom(): number;
}

/** Screen-pixel radius around the pointer within which an element is erased. */
const ERASE_TOLERANCE_PX = 6;

export class EraserTool extends NoOpToolHandler {
  private readonly deps: EraserToolDeps;
  private active = false;
  private erasedAny = false;
  private lastPoint: Point | null = null;

  constructor(deps: EraserToolDeps) {
    super();
    this.deps = deps;
  }

  override onGestureStart(point: Point): void {
    this.deps.history.beginBatch();
    this.active = true;
    this.erasedAny = false;
    this.lastPoint = point;
    this.eraseAt(point);
  }

  override onGestureMove(point: Point): void {
    if (!this.active) return;
    // Erase along the whole swept segment since the last sample, not just at this point, so a fast
    // drag that jumps far between two frames still erases everything the path crossed (competitors do
    // the same). Step size is the hit tolerance so no gap between samples is ever left unchecked.
    const from = this.lastPoint ?? point;
    const tolerance = ERASE_TOLERANCE_PX / this.deps.getZoom();
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(tolerance, 1)));
    for (let step = 1; step <= steps; step++) {
      this.eraseAt({ x: from.x + (dx * step) / steps, y: from.y + (dy * step) / steps });
    }
    this.lastPoint = point;
  }

  override onGestureEnd(): void {
    this.commit();
  }

  /**
   * Abort path (Escape/blur mid-swipe): commit whatever was already erased rather than trying to
   * un-erase it — matches competitors, where releasing/Escaping keeps the erased state, and keeps it
   * undoable (an open batch closed with a snapshot). The pipeline's own post-cancel `cancelBatch` is
   * then a no-op since the batch is already closed.
   */
  override onGestureCancel(): void {
    this.commit();
  }

  private eraseAt(point: Point): void {
    const tolerance = ERASE_TOLERANCE_PX / this.deps.getZoom();
    const target = topmostElementAt(this.deps.scene, point, tolerance);
    if (target) {
      this.deps.scene.deleteElement(target.id);
      this.erasedAny = true;
    }
  }

  private commit(): void {
    if (!this.active) return;
    this.active = false;
    this.lastPoint = null;
    if (this.erasedAny) this.deps.history.endBatch(this.deps.scene.getElements());
    else this.deps.history.cancelBatch();
  }
}
