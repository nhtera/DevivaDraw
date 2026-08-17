/**
 * Dragging one vertex of a selected arrow: move it, and — for the two end vertices — re-attach,
 * detach or re-target its binding based on where it lands. Grabbing a segment's midpoint dot inserts
 * a bend there and drags it immediately.
 *
 * Composed by `selection-tool.ts` alongside the move/resize/rotate/marquee gestures, and owning its
 * own frozen state and history batch the same way they do (see `selection-move-gesture.ts`).
 *
 * The binding rules mirror arrow *creation* exactly, by construction rather than by agreement: the
 * live preview and the commit both come from `bindings/preview-bound-endpoint.ts`, so where the
 * endpoint appears mid-drag is where releasing puts it.
 *
 * Only the first and last vertex ever bind — the same rule `tools/arrow-tool.ts` states for creation.
 * An intermediate bend point has no meaningful attachment.
 */
import type { ArrowBinding, ArrowElement, ArrowType } from "../elements/arrow-element";
import { bindArrowEndpoint, unbindArrowEndpoint } from "../bindings/binding-model";
import { findBindableShapeNear } from "../bindings/binding-scene-sync";
import { maxBindingDistanceSceneUnits } from "../bindings/binding-thresholds";
import { resolveBindingHighlight } from "../bindings/binding-highlight";
import { isBindingOff, previewBoundEndpoint } from "../bindings/preview-bound-endpoint";
import { CONNECTION_POINT_SNAP_PX, nearestConnectionAnchor } from "../bindings/shape-connection-points";
import type { ModifierKeys } from "../input/tool-handler";
import { pointerRadiusMultiplier } from "../input/pointer-precision";
import { absolutePoints, rebaseArrowPoints } from "../render/arrow-geometry";
import type { Point } from "../render/camera";
import type { LinearHandleTarget } from "./linear-handles";
import type { SelectionToolDeps } from "./selection-tool-deps";

/** Frozen pre-gesture state, restored verbatim on cancel — geometry *and* both bindings. */
interface FrozenArrow {
  x: number;
  y: number;
  width: number;
  height: number;
  points: readonly Point[];
  arrowType: ArrowType;
  startBinding: ArrowBinding | null;
  endBinding: ArrowBinding | null;
}

/** Which stored end a vertex index is, or `null` for an intermediate bend point (which never binds). */
function endOfIndex(index: number, vertexCount: number): "start" | "end" | null {
  if (index === 0) return "start";
  if (index === vertexCount - 1) return "end";
  return null;
}

export class LinearPointGesture {
  private readonly deps: SelectionToolDeps;
  private arrowId: string | null = null;
  private frozen: FrozenArrow | null = null;
  /** Index of the vertex being dragged. For a midpoint grab this is the newly inserted vertex, resolved in `begin`. */
  private vertexIndex = 0;
  private highlightId: string | null = null;
  /** `pointerType` of the gesture dragging this vertex — widens the anchor-snap radius for touch; see `input/pointer-precision.ts`. */
  private pointerType: string | undefined;
  /** The one anchor the dragged end would snap to right now (scene space), ringed by the overlay — see `getBindingAnchor`. */
  private bindingAnchor: Point | null = null;

  constructor(deps: SelectionToolDeps) {
    this.deps = deps;
  }

  /**
   * Opens the history batch and freezes the arrow. A midpoint grab inserts its new vertex here rather
   * than on first move, so the very first `apply` already has a real vertex to drag and a cancel with
   * no movement still restores cleanly through the frozen snapshot.
   */
  begin(arrow: ArrowElement, target: LinearHandleTarget, pointerType?: string): boolean {
    const points = absolutePoints({ x: arrow.x, y: arrow.y }, arrow.points);
    this.arrowId = arrow.id;
    this.pointerType = pointerType;
    this.frozen = {
      x: arrow.x,
      y: arrow.y,
      width: arrow.width,
      height: arrow.height,
      points: arrow.points.map((point) => ({ ...point })),
      arrowType: arrow.arrowType,
      startBinding: arrow.startBinding,
      endBinding: arrow.endBinding,
    };
    this.deps.history.beginBatch();

    if (target.kind === "vertex") {
      this.vertexIndex = target.index;
      return true;
    }

    const insertAt = target.segmentIndex + 1;
    const from = points[target.segmentIndex]!;
    const to = points[insertAt]!;
    const inserted = [...points.slice(0, insertAt), { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, ...points.slice(insertAt)];
    this.vertexIndex = insertAt;
    this.writePoints(inserted);
    return true;
  }

  /**
   * Moves the dragged vertex to `point`, snapped to a bindable target's outline when this is an end
   * vertex over one. Geometry is written live (as every move gesture does); binding *fields* are not
   * touched until `finish` — a binding write per pointer move would be rebroadcast to every peer in a
   * live session, which is the amplification `bindings/binding-scene-sync.ts` documents at length.
   */
  apply(point: Point, modifiers: ModifierKeys): void {
    const arrow = this.currentArrow();
    if (!arrow) return;
    const points = absolutePoints({ x: arrow.x, y: arrow.y }, arrow.points);
    const resolved = this.resolveDraggedPoint(points, point, modifiers);
    points[this.vertexIndex] = resolved;
    this.writePoints(points);
  }

  /** Commits: geometry is already written, so this only settles the binding for an end vertex, then closes the batch. */
  finish(point: Point, modifiers: ModifierKeys): void {
    const arrow = this.currentArrow();
    if (!arrow || !this.arrowId) {
      this.reset();
      return;
    }

    const points = absolutePoints({ x: arrow.x, y: arrow.y }, arrow.points);
    const end = endOfIndex(this.vertexIndex, points.length);
    if (end) this.commitBinding(this.arrowId, end, points, modifiers);

    // 2 -> 3 vertices makes a straight arrow a curved one, the same rule arrow creation applies.
    if (points.length > 2 && arrow.arrowType === "straight") {
      this.deps.scene.updateElement(this.arrowId, { arrowType: "curved" } as Partial<ArrowElement>);
    }

    this.deps.history.endBatch(this.deps.scene.getElements());
    this.reset();
  }

  /** Restores the frozen geometry *and* bindings, then cancels the batch — Escape mid-drag leaves no trace. */
  cancel(): void {
    if (this.arrowId && this.frozen) {
      const { startBinding, endBinding, ...geometry } = this.frozen;
      this.deps.scene.updateElement(this.arrowId, geometry as Partial<ArrowElement>);
      this.restoreBinding(this.arrowId, "start", startBinding);
      this.restoreBinding(this.arrowId, "end", endBinding);
    }
    this.deps.history.cancelBatch();
    this.reset();
  }

  /** The shape the dragged endpoint would attach to right now, for the overlay halo. `null` when it would not bind. */
  getBindingHighlightIds(): readonly string[] {
    return this.highlightId ? [this.highlightId] : [];
  }

  /** The active snap anchor for the overlay's ring — the same "this exact dot" affordance the arrow tool shows while drawing. */
  getBindingAnchor(): Point | null {
    return this.bindingAnchor;
  }

  private currentArrow(): ArrowElement | null {
    if (!this.arrowId) return null;
    const element = this.deps.scene.getElement(this.arrowId);
    return element?.type === "arrow" && !element.isDeleted ? element : null;
  }

  /** Where the dragged vertex actually goes: the raw pointer, or its snapped position when this end is over a bindable shape. */
  private resolveDraggedPoint(points: readonly Point[], point: Point, modifiers: ModifierKeys): Point {
    this.highlightId = null;
    this.bindingAnchor = null;
    const end = endOfIndex(this.vertexIndex, points.length);
    if (!end || isBindingOff(modifiers, this.deps.getBindingEnabled?.())) return point;

    const threshold = maxBindingDistanceSceneUnits(this.deps.getZoom(), this.pointerType);
    this.highlightId = resolveBindingHighlight(this.deps.scene.selectableElements(), point, threshold);
    const target = findBindableShapeNear(this.deps.scene, point, threshold);
    if (!target || target.id === this.arrowId) return point;
    this.bindingAnchor = nearestConnectionAnchor(target, point, this.connectionSnapRadius())?.point ?? null;

    const preview = previewBoundEndpoint(target, point, this.referencePointFor(points), this.connectionSnapRadius());
    return preview?.point ?? point;
  }

  /** The anchor-snap distance in scene units — a screen-space constant (widened for coarse pointers), so a dot is equally easy to hit at any zoom. */
  private connectionSnapRadius(): number {
    // Zero radius is how "snap to midpoints: off" is expressed — `nearestConnectionAnchor` and
    // `previewBoundEndpoint` both treat a non-positive radius as "no anchor", so the endpoint still
    // binds (by focus/gap) but is no longer pulled onto one of the four edge midpoints.
    if (this.deps.getMidpointSnapEnabled?.() === false) return 0;
    return (CONNECTION_POINT_SNAP_PX * pointerRadiusMultiplier(this.pointerType)) / this.deps.getZoom();
  }

  /** The arrow's *other* end, which sets the direction a binding aims along. */
  private referencePointFor(points: readonly Point[]): Point {
    return this.vertexIndex === 0 ? points[points.length - 1]! : points[0]!;
  }

  /**
   * Settles `end`'s binding from where it was released: attach, re-target, or detach. Always routed
   * through `bindArrowEndpoint`/`unbindArrowEndpoint` so the shape's reciprocal `boundElements`
   * back-ref stays in lockstep — rebinding to a different shape drops the old back-ref for free.
   */
  private commitBinding(arrowId: string, end: "start" | "end", points: readonly Point[], modifiers: ModifierKeys): void {
    const droppedAt = points[this.vertexIndex]!;
    const threshold = isBindingOff(modifiers, this.deps.getBindingEnabled?.()) ? 0 : maxBindingDistanceSceneUnits(this.deps.getZoom(), this.pointerType);
    const target = threshold > 0 ? findBindableShapeNear(this.deps.scene, droppedAt, threshold) : null;

    if (!target) {
      unbindArrowEndpoint(this.deps.scene, arrowId, end); // no-op when it was not bound
      return;
    }

    const preview = previewBoundEndpoint(target, droppedAt, this.referencePointFor(points), this.connectionSnapRadius());
    if (!preview) {
      unbindArrowEndpoint(this.deps.scene, arrowId, end);
      return;
    }
    bindArrowEndpoint(this.deps.scene, arrowId, end, target.id, { focus: preview.focus, gap: preview.gap, fixedPoint: preview.fixedPoint });
  }

  /**
   * Puts `binding` back exactly as it was, including the target's back-ref, or clears it if there was
   * none. Forwarded field-for-field rather than rebuilt from named fields, so an optional one this
   * gesture never reads (`fixedPoint`) comes back exactly as it was stored — including not being
   * there at all. A cancelled drag must leave no trace, and an added key is a trace.
   */
  private restoreBinding(arrowId: string, end: "start" | "end", binding: ArrowBinding | null): void {
    if (binding) {
      const { elementId, ...fields } = binding;
      bindArrowEndpoint(this.deps.scene, arrowId, end, elementId, fields);
    } else unbindArrowEndpoint(this.deps.scene, arrowId, end);
  }

  private writePoints(points: readonly Point[]): void {
    if (!this.arrowId) return;
    const rebased = rebaseArrowPoints(points);
    const changes: Partial<ArrowElement> = { x: rebased.x, y: rebased.y, width: rebased.width, height: rebased.height, points: rebased.points };
    this.deps.scene.updateElement(this.arrowId, changes);
  }

  private reset(): void {
    this.arrowId = null;
    this.frozen = null;
    this.vertexIndex = 0;
    this.highlightId = null;
    this.pointerType = undefined;
    this.bindingAnchor = null;
  }
}
