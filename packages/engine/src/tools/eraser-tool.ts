/**
 * Eraser tool: drag over elements to delete them, the same affordance Excalidraw/tldraw expose.
 * Elements the swipe touches are *marked* (not deleted immediately) and rendered dimmed as a preview
 * — see `getPendingEraseIds`, read by the render loop — then all deleted together on release, so the
 * whole swipe is one history batch ("one drag = one undo step"). Escape/blur mid-swipe cancels with
 * nothing deleted (the marks just clear), matching competitors. Deletes are soft (see
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

/** Screen-pixel radius around the pointer within which an element is marked for erasing. */
const ERASE_TOLERANCE_PX = 6;

export class EraserTool extends NoOpToolHandler {
  private readonly deps: EraserToolDeps;
  private active = false;
  private lastPoint: Point | null = null;
  /** Elements the current swipe has touched — dimmed as a delete-preview, removed together on release. */
  private readonly pending = new Set<string>();

  constructor(deps: EraserToolDeps) {
    super();
    this.deps = deps;
  }

  /** Ids marked for erasing this swipe (empty when idle) — the render loop dims these as a live preview. */
  getPendingEraseIds(): ReadonlySet<string> {
    return this.pending;
  }

  override onGestureStart(point: Point): void {
    this.active = true;
    this.pending.clear();
    this.lastPoint = point;
    this.markAt(point);
  }

  override onGestureMove(point: Point): void {
    if (!this.active) return;
    // Mark along the whole swept segment since the last sample, not just this point, so a fast drag
    // that jumps far between frames still catches everything the path crossed (competitors do the
    // same). Step size is the hit tolerance so no gap between samples is left unchecked.
    const from = this.lastPoint ?? point;
    const tolerance = ERASE_TOLERANCE_PX / this.deps.getZoom();
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(tolerance, 1)));
    for (let step = 1; step <= steps; step++) {
      this.markAt({ x: from.x + (dx * step) / steps, y: from.y + (dy * step) / steps });
    }
    this.lastPoint = point;
  }

  override onGestureEnd(): void {
    if (!this.active) return;
    this.active = false;
    this.lastPoint = null;
    if (this.pending.size === 0) return;
    // Commit the whole swipe as one undo step.
    this.deps.history.beginBatch();
    for (const id of this.pending) this.deps.scene.deleteElement(id);
    this.deps.history.endBatch(this.deps.scene.getElements());
    this.pending.clear();
  }

  /** Abort path (Escape/blur mid-swipe): nothing was deleted yet, so just drop the marks — a true cancel, matching competitors' Escape. */
  override onGestureCancel(): void {
    this.active = false;
    this.lastPoint = null;
    this.pending.clear();
  }

  private markAt(point: Point): void {
    const tolerance = ERASE_TOLERANCE_PX / this.deps.getZoom();
    const target = topmostElementAt(this.deps.scene, point, tolerance);
    if (target) this.pending.add(target.id);
  }
}
