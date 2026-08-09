/**
 * Line/polyline tool with two creation affordances, matching `arrow-tool.ts` (its sibling) and every
 * mainstream whiteboard: a real drag (pointer movement beyond a small threshold between down and up)
 * commits an instant straight 2-point line; a plain click (no meaningful movement) instead enters
 * multi-point mode — click to add each further vertex, a click near the first vertex closes the shape
 * into a filled polygon, and Enter/double-click/Escape commit whatever's been placed as an open
 * polyline. One polyline spans multiple pointer gestures (each click is its own down/up cycle), so
 * state persists across `onGestureStart`/`onGestureEnd` instead of resetting every gesture.
 *
 * The draft element is created on the first `onGestureStart` so a drag can live-preview its second
 * endpoint via `onGestureMove`; whether that first gesture was a click or a drag is decided from the
 * down-to-up distance at `onGestureEnd`, which is also what keeps a tiny pointer-jitter during a click
 * from being mistaken for a drag.
 */
import type { LineElement } from "../elements/shape-elements";
import { createLineElement } from "../elements/shape-elements";
import { NoOpToolHandler } from "../input/tool-handler";
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";
import type { Scene } from "../scene/scene";
import { constrainSegmentAngle } from "./constrain-segment-angle";
import type { ShapeToolHistory } from "./drag-shape-tool-base";
import type { ShapeStyleState } from "./shape-style-state";

export interface LineToolDeps {
  scene: Scene;
  styleState: ShapeStyleState;
  history: ShapeToolHistory;
  /**
   * Current camera zoom. Click-proximity thresholds (drag-vs-click, double-click, "close near start")
   * are defined in screen pixels and converted to scene units at comparison time via this — otherwise
   * the same *scene-unit* threshold would feel wildly more/less forgiving depending on zoom level (a
   * 10-unit radius is trivial to hit zoomed in, and nearly impossible to hit precisely zoomed out).
   */
  getZoom(): number;
  /** Called once a polyline is committed (not on a discarded <2-vertex draft), with its id — see `drag-shape-tool-base.ts`'s `onCreated`. */
  onCreated?: (elementId: string) => void;
}

/** Window (ms) within which two clicks near the same spot count as a finishing double-click. */
const DOUBLE_CLICK_WINDOW_MS = 300;
/** Max screen-pixel distance between two clicks to count as "the same spot" for double-click detection. */
const DOUBLE_CLICK_PROXIMITY_PX = 6;
/** Pointer movement beyond this (screen px) between the first down and up counts as a real drag, not a click. */
const DRAG_VS_CLICK_THRESHOLD_PX = 4;
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
  private firstGestureStartPoint: Point | null = null;
  /** True only before the very first `onGestureEnd` of a new polyline — see module doc on the drag-vs-click split. */
  private isFirstVertexGesture = true;
  private lastClickAt = 0;
  private lastClickPoint: Point | null = null;

  constructor(deps: LineToolDeps) {
    super();
    this.deps = deps;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `modifiers` kept to match `ToolHandler`'s signature
  override onGestureStart(point: Point, modifiers: ModifierKeys): void {
    if (this.points.length > 0) return; // multi-point continuation: vertex only added at gesture end
    this.deps.history.beginBatch();
    this.points = [point];
    this.firstGestureStartPoint = point;
    const element: LineElement = createLineElement({ x: point.x, y: point.y, width: 0, height: 0, points: [{ x: 0, y: 0 }], ...this.deps.styleState.getStyle() });
    this.elementId = this.deps.scene.addElement(element).id;
  }

  override onGestureMove(point: Point, modifiers: ModifierKeys): void {
    if (!this.elementId || !this.isFirstVertexGesture) return;
    const start = this.points[0];
    if (start) this.syncElement([start, constrainSegmentAngle(start, point, modifiers.shift)]); // live-preview the drag's second endpoint (shift = angle-locked)
  }

  override onGestureEnd(point: Point, modifiers: ModifierKeys): void {
    if (!this.elementId) return;

    if (this.isFirstVertexGesture) {
      this.isFirstVertexGesture = false;
      const start = this.firstGestureStartPoint ?? point;
      if (distance(start, point) > DRAG_VS_CLICK_THRESHOLD_PX / this.deps.getZoom()) {
        this.points = [start, constrainSegmentAngle(start, point, modifiers.shift)];
        this.finish(); // a drag: commit an instant straight 2-point line
        return;
      }
      // A click, not a drag: stay in multi-point mode with just vertex 1 committed so far.
      this.points = [start];
      this.syncElement();
      return;
    }

    // Each further vertex snaps its angle relative to the previously placed vertex when shift is held.
    const previous = this.points[this.points.length - 1] ?? point;
    const vertex = constrainSegmentAngle(previous, point, modifiers.shift);

    if (this.isDoubleClick(point)) {
      this.finish();
      return;
    }

    const first = this.points[0];
    if (this.points.length >= MIN_VERTICES_TO_CLOSE && first && distance(first, vertex) <= CLOSE_POLYGON_DISTANCE_PX / this.deps.getZoom()) {
      this.finish(true);
      return;
    }

    this.points = [...this.points, vertex];
    this.syncElement();
  }

  /**
   * Abort path (Escape mid-click, `pointercancel`, blur): the pipeline already cancels any open
   * history batch before calling this — see `input/pointer-event-pipeline.ts`. With the batch gone
   * there is no partial state worth keeping: the whole in-progress polyline (not just the interrupted
   * click) is abandoned, so any vertices already placed are soft-deleted along with the draft element.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `modifiers` kept to match `ToolHandler`'s signature
  override onGestureCancel(modifiers: ModifierKeys): void {
    this.deleteDraftAndReset();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `modifiers` kept to match `ToolHandler`'s signature
  override onKeyDown(key: string, modifiers: ModifierKeys): void {
    if (key === "Enter" || key === "Escape") this.finish();
  }

  private isDoubleClick(point: Point): boolean {
    const now = Date.now();
    const proximity = DOUBLE_CLICK_PROXIMITY_PX / this.deps.getZoom();
    const isDouble = this.lastClickPoint !== null && now - this.lastClickAt <= DOUBLE_CLICK_WINDOW_MS && distance(this.lastClickPoint, point) <= proximity;
    this.lastClickAt = now;
    this.lastClickPoint = point;
    return isDouble;
  }

  private syncElement(points: readonly Point[] = this.points): void {
    if (!this.elementId) return;
    const bounds = boundsOf(points);
    const relativePoints = points.map((point) => ({ x: point.x - bounds.x, y: point.y - bounds.y }));
    // `Scene.updateElement`'s `ElementUpdate` type is built from `keyof AnyElement`, which (being a
    // union) only includes fields common to *every* member — `points` is `LineElement`-only, so a
    // pre-typed `Partial<LineElement>` local (structurally wider, not an inline literal) is needed to
    // pass it through; `Scene` itself just spreads `changes`, so this is a type-level-only gap.
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
    const createdId = this.elementId;
    this.reset();
    if (createdId) this.deps.onCreated?.(createdId);
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
    this.firstGestureStartPoint = null;
    this.isFirstVertexGesture = true;
    // Cleared too: a fresh polyline's first click must never be mistaken for a double-click/close
    // against a click that belonged to a now-abandoned previous one.
    this.lastClickAt = 0;
    this.lastClickPoint = null;
  }
}
