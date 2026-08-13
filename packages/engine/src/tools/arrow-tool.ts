/**
 * Arrow creation tool: a real drag (pointer movement beyond a small threshold between down and up)
 * commits an instant straight 2-point arrow, matching every drag-to-create shape tool's affordance.
 * A plain click (no meaningful movement) instead enters multi-point mode — click to add each further
 * vertex, matching `line-tool.ts`'s exact click-accumulation UX (see that file's doc), with
 * double-click/Enter/Escape finishing whatever's been placed. `arrowType` is decided at finish time
 * from the final vertex count: exactly 2 -> `"straight"`, 3+ -> `"curved"`.
 *
 * Only the *first* and *last* vertex are ever checked for shape binding (never a curved arrow's
 * intermediate bend points) — see `arrow-endpoint-binding.ts`, which this tool calls once at finish.
 */
import { resolveBindingHighlights } from "../bindings/binding-highlight";
import { findBindableShapeNear } from "../bindings/binding-scene-sync";
import { maxBindingDistanceSceneUnits } from "../bindings/binding-thresholds";
import { isBindingSuppressed, previewBoundEndpoint } from "../bindings/preview-bound-endpoint";
import { CONNECTION_POINT_SNAP_PX } from "../bindings/shape-connection-points";
import { createArrowElement } from "../elements/arrow-element";
import type { ArrowElement, ArrowType } from "../elements/arrow-element";
import { NoOpToolHandler } from "../input/tool-handler";
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";
import { rebaseArrowPoints } from "../render/arrow-geometry";
import type { Scene } from "../scene/scene";
import { applyEndpointBindingsOnFinish } from "./arrow-endpoint-binding";
import { constrainSegmentAngle } from "./constrain-segment-angle";
import type { ShapeToolHistory } from "./drag-shape-tool-base";
import type { ShapeStyleState } from "./shape-style-state";

export interface ArrowToolDeps {
  scene: Scene;
  styleState: ShapeStyleState;
  history: ShapeToolHistory;
  /** Current camera zoom — screen-pixel thresholds (drag-vs-click, double-click, bind proximity) are converted to scene units at comparison time via this, same reasoning as `line-tool.ts`'s `getZoom`. */
  getZoom(): number;
  /** Called once an arrow is committed (not on a discarded <2-vertex draft), with its id — see `drag-shape-tool-base.ts`'s `onCreated`. */
  onCreated?: (elementId: string) => void;
}

const DOUBLE_CLICK_WINDOW_MS = 300;
const DOUBLE_CLICK_PROXIMITY_PX = 6;
/** Pointer movement beyond this (screen px) between the first down and up counts as a real drag, not a click. */
const DRAG_VS_CLICK_THRESHOLD_PX = 4;
const MIN_VERTICES_TO_COMMIT = 2;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class ArrowTool extends NoOpToolHandler {
  private readonly deps: ArrowToolDeps;
  private vertices: Point[] = [];
  private elementId: string | null = null;
  private firstGestureStartPoint: Point | null = null;
  /** True only before the very first `onGestureEnd` of a new arrow — see module doc on the drag-vs-click split. */
  private isFirstVertexGesture = true;
  private lastClickAt = 0;
  private lastClickPoint: Point | null = null;
  /** Shapes the overlay is currently haloing as "you can connect here" — see `getBindingHighlightIds`. */
  private bindingHighlightIds: readonly string[] = [];

  constructor(deps: ArrowToolDeps) {
    super();
    this.deps = deps;
  }

  /**
   * Ids of the shapes to halo this frame. A getter the host polls each frame rather than a change
   * callback, matching how the eraser's pending-delete ids, the laser's trail and the lasso's path
   * already reach the render loop — the loop is rebuilt only on scene swap, so it reads state
   * through getters instead of holding values that would go stale.
   *
   * Overlay state only: nothing here is ever written to `Scene`. Hover is a per-pointermove event,
   * and under live collaboration every touched element is rebroadcast to every peer, so a hover that
   * wrote to the scene would flood the session with no-op deltas.
   */
  getBindingHighlightIds(): readonly string[] {
    return this.bindingHighlightIds;
  }

  /** Drops the halo — called when the arrow tool stops being the active tool, since a hover it never receives can no longer clear itself. */
  clearBindingHighlight(): void {
    this.bindingHighlightIds = [];
  }

  private updateHighlight(points: readonly (Point | null)[], modifiers: ModifierKeys): void {
    // Suppress held means nothing will bind, so nothing should claim it will.
    if (isBindingSuppressed(modifiers)) {
      this.bindingHighlightIds = [];
      return;
    }
    const elements = this.deps.scene.getElements();
    const threshold = maxBindingDistanceSceneUnits(this.deps.getZoom());
    this.bindingHighlightIds = resolveBindingHighlights(elements, points, threshold);
  }

  /**
   * Halo whatever a click right here would bind to. In multi-point mode (between clicks, when no
   * gesture is in progress) the already-placed first vertex stays lit alongside the pointer, so a
   * click-built arrow shows the same "connecting these two" pair a dragged one does.
   */
  override onHover(point: Point, modifiers: ModifierKeys): void {
    this.updateHighlight([this.vertices[0] ?? null, point], modifiers);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `modifiers` kept to match `ToolHandler`'s signature
  override onGestureStart(point: Point, modifiers: ModifierKeys): void {
    if (this.vertices.length > 0) return; // multi-point continuation: vertex only added at gesture end, mirrors LineTool
    this.deps.history.beginBatch();
    this.vertices = [point];
    this.firstGestureStartPoint = point;
    const element = createArrowElement({ x: point.x, y: point.y, points: [{ x: 0, y: 0 }], ...this.deps.styleState.getStyle() });
    this.elementId = this.deps.scene.addElement(element).id;
  }

  override onGestureMove(point: Point, modifiers: ModifierKeys): void {
    if (!this.elementId || !this.isFirstVertexGesture) return;
    const start = this.vertices[0]!;
    const moving = constrainSegmentAngle(start, point, modifiers.shift);
    // Both ends, so a short arrow spanning two shapes reads as "connecting these two" rather than
    // only lighting up whichever one the pointer happens to be over.
    this.updateHighlight([start, moving], modifiers);
    // Draw the endpoints where releasing would actually put them — clipped to their targets'
    // outlines — rather than under the pointer and then jumping on release.
    this.syncElement(this.snappedEnds(start, moving, modifiers));
  }

  /**
   * `[start, moving]` with each end clipped to whatever bindable shape it is over. Resolved in the
   * same order, and against the same reference points, as the commit in `arrow-endpoint-binding.ts`:
   * the start first, then the end aimed at the *already-snapped* start. Anything else and the
   * preview would show a position the release then corrects.
   */
  private snappedEnds(start: Point, moving: Point, modifiers: ModifierKeys): [Point, Point] {
    if (isBindingSuppressed(modifiers)) return [start, moving];
    const threshold = maxBindingDistanceSceneUnits(this.deps.getZoom());
    const snapRadius = this.connectionSnapRadius();
    const startTarget = findBindableShapeNear(this.deps.scene, start, threshold);
    const endTarget = findBindableShapeNear(this.deps.scene, moving, threshold);

    const snappedStart = startTarget ? (previewBoundEndpoint(startTarget, start, moving, snapRadius)?.point ?? start) : start;
    const snappedEnd = endTarget ? (previewBoundEndpoint(endTarget, moving, snappedStart, snapRadius)?.point ?? moving) : moving;
    return [snappedStart, snappedEnd];
  }

  /** The anchor-snap distance in scene units — a screen-space constant, so a dot is equally easy to hit at any zoom. */
  private connectionSnapRadius(): number {
    return CONNECTION_POINT_SNAP_PX / this.deps.getZoom();
  }

  override onGestureEnd(point: Point, modifiers: ModifierKeys): void {
    if (!this.elementId) return;

    if (this.isFirstVertexGesture) {
      this.isFirstVertexGesture = false;
      const startPoint = this.firstGestureStartPoint ?? point;
      const threshold = DRAG_VS_CLICK_THRESHOLD_PX / this.deps.getZoom();
      if (distance(startPoint, point) > threshold) {
        this.vertices = [startPoint, constrainSegmentAngle(startPoint, point, modifiers.shift)];
        this.finish(modifiers);
        return;
      }
      // A click, not a drag: stay in multi-point mode with just vertex 1 committed so far.
      this.syncElement(this.vertices);
      return;
    }

    if (this.isDoubleClick(point)) {
      this.finish(modifiers);
      return;
    }
    // Each further vertex snaps its angle relative to the previously placed vertex when shift is held.
    const previous = this.vertices[this.vertices.length - 1] ?? point;
    this.vertices = [...this.vertices, constrainSegmentAngle(previous, point, modifiers.shift)];
    this.syncElement(this.vertices);
  }

  /**
   * Abort path (Escape mid-click, `pointercancel`, blur): the pipeline already cancels any open
   * history batch before calling this — see `drag-shape-tool-base.ts`'s identical comment for the
   * full rationale. Only the `Scene` side needs undoing here.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `modifiers` kept to match `ToolHandler`'s signature
  override onGestureCancel(modifiers: ModifierKeys): void {
    if (this.elementId) this.deps.scene.deleteElement(this.elementId);
    this.reset();
  }

  override onKeyDown(key: string, modifiers: ModifierKeys): void {
    if (key === "Enter" || key === "Escape") this.finish(modifiers);
  }

  private isDoubleClick(point: Point): boolean {
    const now = Date.now();
    const proximity = DOUBLE_CLICK_PROXIMITY_PX / this.deps.getZoom();
    const isDouble = this.lastClickPoint !== null && now - this.lastClickAt <= DOUBLE_CLICK_WINDOW_MS && distance(this.lastClickPoint, point) <= proximity;
    this.lastClickAt = now;
    this.lastClickPoint = point;
    return isDouble;
  }

  private syncElement(points: readonly Point[]): void {
    if (!this.elementId) return;
    const rebased = rebaseArrowPoints(points);
    const changes: Partial<ArrowElement> = { x: rebased.x, y: rebased.y, width: rebased.width, height: rebased.height, points: rebased.points };
    this.deps.scene.updateElement(this.elementId, changes);
  }

  /** Commits the draft. Fewer than 2 vertices has nothing meaningful to keep (mirrors `LineTool`'s single-vertex discard rule), so it's discarded instead. */
  private finish(modifiers: ModifierKeys): void {
    const elementId = this.elementId;
    if (!elementId || this.vertices.length < MIN_VERTICES_TO_COMMIT) {
      this.discardDraft();
      return;
    }

    this.syncElement(this.vertices);
    const arrowType: ArrowType = this.vertices.length === 2 ? "straight" : "curved";
    this.deps.scene.updateElement(elementId, { arrowType } as Partial<ArrowElement>);

    const threshold = isBindingSuppressed(modifiers) ? 0 : maxBindingDistanceSceneUnits(this.deps.getZoom());
    // Binding is a *bonus* on top of a committed arrow, never a precondition for one. A geometry gap
    // (a bindable-list / border-formula mismatch) used to throw from here, skipping `endBatch`,
    // `reset` and `onCreated` — leaving the tool wedged mid-gesture with an open history batch, so
    // the next undo behaved unpredictably. Logged rather than swallowed: any such gap must stay
    // visible in the console, it just must not cost the user their arrow.
    try {
      applyEndpointBindingsOnFinish(this.deps.scene, elementId, this.vertices, threshold, this.connectionSnapRadius());
    } catch (error) {
      console.error(`arrow-tool: endpoint binding failed for "${elementId}" (arrow committed unbound):`, error);
    }

    this.deps.history.endBatch(this.deps.scene.getElements());
    this.reset();
    this.deps.onCreated?.(elementId);
  }

  private discardDraft(): void {
    this.deps.history.cancelBatch();
    if (this.elementId) this.deps.scene.deleteElement(this.elementId);
    this.reset();
  }

  /** Every exit path — commit, discard, cancel — funnels through here, so the halo is cleared in exactly one place. */
  private reset(): void {
    this.vertices = [];
    this.elementId = null;
    this.firstGestureStartPoint = null;
    this.isFirstVertexGesture = true;
    this.lastClickAt = 0;
    this.lastClickPoint = null;
    this.bindingHighlightIds = [];
  }
}
