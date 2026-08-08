/**
 * Multi-point line/polyline tool: click adds a vertex, a click near the first vertex closes the
 * shape into a filled polygon, and Enter/double-click/Escape commit whatever's been placed so far
 * as an open polyline. Unlike the single-drag shape tools (`drag-shape-tool-base.ts`), one polyline
 * spans *multiple* pointer gestures — each click is its own down/up cycle — so state persists across
 * `onGestureStart`/`onGestureEnd` calls instead of resetting every gesture.
 *
 * A vertex is only committed on `onGestureEnd` (pointer-up), not `onGestureStart` — so a tiny
 * pointer-jitter between down and up never adds two vertices for what the user experienced as one
 * click.
 */
import type { LineElement } from "../elements/shape-elements";
import { createLineElement } from "../elements/shape-elements";
import { NoOpToolHandler } from "../input/tool-handler";
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";
import type { Scene } from "../scene/scene";
import type { ShapeToolHistory } from "./drag-shape-tool-base";
import type { ShapeStyleState } from "./shape-style-state";

export interface LineToolDeps {
  scene: Scene;
  styleState: ShapeStyleState;
  history: ShapeToolHistory;
  /**
   * Current camera zoom. Click-proximity thresholds (double-click, "close near start") are defined
   * in screen pixels and converted to scene units at comparison time via this — otherwise the same
   * *scene-unit* threshold would feel wildly more/less forgiving depending on zoom level (a 10-unit
   * radius is trivial to hit zoomed in, and nearly impossible to hit precisely zoomed out).
   */
  getZoom(): number;
}

/** Window (ms) within which two clicks near the same spot count as a finishing double-click. */
const DOUBLE_CLICK_WINDOW_MS = 300;
/** Max screen-pixel distance between two clicks to count as "the same spot" for double-click detection. */
const DOUBLE_CLICK_PROXIMITY_PX = 6;
/** Screen-pixel distance from the first vertex within which a click closes the shape into a polygon. */
const CLOSE_POLYGON_DISTANCE_PX = 10;
/** Vertices already placed (before the closing click) required before "close near start" applies — a 2-vertex loop has no area. */
const MIN_VERTICES_TO_CLOSE = 3;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function boundsOf(points: readonly Point[]): { x: number; y: number; width: number; height: number } {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export class LineTool extends NoOpToolHandler {
  private readonly deps: LineToolDeps;
  private points: Point[] = [];
  private elementId: string | null = null;
  private lastClickAt = 0;
  private lastClickPoint: Point | null = null;

  constructor(deps: LineToolDeps) {
    super();
    this.deps = deps;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see module doc: the vertex is captured on gesture end, not start
  override onGestureStart(point: Point, modifiers: ModifierKeys): void {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `modifiers` kept to match `ToolHandler`'s signature
  override onGestureEnd(point: Point, modifiers: ModifierKeys): void {
    const zoom = this.deps.getZoom();
    const doubleClickProximity = DOUBLE_CLICK_PROXIMITY_PX / zoom;
    const closePolygonDistance = CLOSE_POLYGON_DISTANCE_PX / zoom;

    const now = Date.now();
    const isDoubleClick =
      this.points.length > 0 &&
      now - this.lastClickAt <= DOUBLE_CLICK_WINDOW_MS &&
      this.lastClickPoint !== null &&
      distance(this.lastClickPoint, point) <= doubleClickProximity;
    this.lastClickAt = now;
    this.lastClickPoint = point;

    if (isDoubleClick) {
      this.finish();
      return;
    }

    const first = this.points[0];
    if (this.points.length >= MIN_VERTICES_TO_CLOSE && first && distance(first, point) <= closePolygonDistance) {
      this.finish(true);
      return;
    }

    this.addVertex(point);
  }

  /**
   * Abort path (Escape mid-click, `pointercancel`, blur): the pipeline already cancels any open
   * history batch before calling this — see `input/pointer-event-pipeline.ts` — regardless of which
   * click in the polyline was interrupted. With the batch gone there is no partial state worth
   * keeping: the whole in-progress polyline (not just the interrupted click) is abandoned, so any
   * vertices already placed are soft-deleted along with the draft element instead of surviving for a
   * later `finish()` that would have nothing valid to commit them into (the un-undoable-element bug
   * this guards against).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `modifiers` kept to match `ToolHandler`'s signature
  override onGestureCancel(modifiers: ModifierKeys): void {
    this.deleteDraftAndReset();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `modifiers` kept to match `ToolHandler`'s signature
  override onKeyDown(key: string, modifiers: ModifierKeys): void {
    if (key === "Enter" || key === "Escape") this.finish();
  }

  private addVertex(point: Point): void {
    if (this.points.length === 0) {
      this.deps.history.beginBatch();
      this.points = [point];
      const element: LineElement = createLineElement({
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
        points: [{ x: 0, y: 0 }],
        ...this.deps.styleState.getStyle(),
      });
      this.elementId = this.deps.scene.addElement(element).id;
      return;
    }
    this.points = [...this.points, point];
    this.syncElement();
  }

  private syncElement(): void {
    if (!this.elementId) return;
    const bounds = boundsOf(this.points);
    const relativePoints = this.points.map((point) => ({ x: point.x - bounds.x, y: point.y - bounds.y }));
    // `Scene.updateElement`'s `ElementUpdate` type is built from `keyof AnyElement`, which (being a
    // union) only includes fields common to *every* member — `points` is `LineElement`-only, so a
    // pre-typed `Partial<LineElement>` local (structurally wider, not an inline literal) is needed
    // to pass it through; `Scene` itself just spreads `changes`, so this is a type-level-only gap,
    // not a runtime one.
    const changes: Partial<LineElement> = { ...bounds, points: relativePoints };
    this.deps.scene.updateElement(this.elementId, changes);
  }

  /** Commits the draft. Fewer than 2 vertices has nothing meaningful to keep, so it's discarded instead. */
  private finish(closeAsPolygon = false): void {
    if (!this.elementId || this.points.length < 2) {
      this.discardDraft();
      return;
    }
    if (closeAsPolygon) {
      const first = this.points[0];
      if (first) this.points = [...this.points, first];
    }
    this.syncElement();
    this.deps.history.endBatch(this.deps.scene.getElements());
    this.reset();
  }

  /** Fewer than 2 vertices placed when finishing: nothing meaningful to keep, so this also cancels the still-open batch. */
  private discardDraft(): void {
    this.deps.history.cancelBatch();
    this.deleteDraftAndReset();
  }

  /** Soft-deletes the draft element (if any vertex was ever placed) and resets all per-polyline state. */
  private deleteDraftAndReset(): void {
    if (this.elementId) this.deps.scene.deleteElement(this.elementId);
    this.reset();
  }

  private reset(): void {
    this.points = [];
    this.elementId = null;
    // Cleared too: a fresh polyline's first click must never be mistaken for a double-click/close
    // against a click that belonged to a now-abandoned previous one.
    this.lastClickAt = 0;
    this.lastClickPoint = null;
  }
}
