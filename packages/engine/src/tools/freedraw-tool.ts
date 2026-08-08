/**
 * Freehand ink tool: captures every pointer sample (position + pressure) for the duration of one
 * gesture into a raw point array, committing a single `FreedrawElement` to the scene on
 * pointer-up. Mirrors the shape tools' gesture-batching contract (`drag-shape-tool-base.ts`): one
 * history entry per stroke, an aborted gesture soft-deletes the in-progress draft. A zero-movement
 * gesture (a plain tap) still commits — as a single-point "dot" stroke, matching how every other
 * whiteboard tool treats a tap-to-place gesture — rather than being discarded like a shape tool's
 * zero-size drag (a rectangle/ellipse with no size is invisible; a dot is a deliberate mark).
 *
 * Unlike the drag-shape tools, the draft element is *not* what the interactive/static layer shows
 * mid-gesture via the rough.js dispatch — freedraw always renders through `render/freedraw-renderer.ts`
 * regardless of draft-vs-committed state, so the live preview is just this same in-progress `Scene`
 * element being redrawn on every `Scene.updateElement` call, no separate preview path needed.
 */
import type { FreedrawElement, FreedrawPoint } from "../elements/freedraw-element";
import { createFreedrawElement } from "../elements/freedraw-element";
import { DEFAULT_SIMULATED_PRESSURE } from "../input/pointer-event-types";
import { NoOpToolHandler } from "../input/tool-handler";
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";
import { freedrawSceneRadius } from "../render/freedraw-renderer";
import type { Scene } from "../scene/scene";
import type { ShapeToolHistory } from "./drag-shape-tool-base";
import type { ShapeStyleState } from "./shape-style-state";

export { DEFAULT_SIMULATED_PRESSURE } from "../input/pointer-event-types";
/** `PointerEvent.pointerType` values that never carry a genuine pressure signal; anything else (chiefly `"pen"`) is trusted at face value. */
const NO_REAL_PRESSURE_POINTER_TYPES = new Set(["mouse", "touch"]);

export interface FreedrawToolDeps {
  scene: Scene;
  styleState: ShapeStyleState;
  history: ShapeToolHistory;
}

interface AbsoluteSample {
  x: number;
  y: number;
  pressure: number;
}

function bboxOf(points: readonly AbsoluteSample[]): { x: number; y: number; width: number; height: number } {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export class FreedrawTool extends NoOpToolHandler {
  private readonly deps: FreedrawToolDeps;
  /** Absolute scene-space samples for the in-progress stroke; re-based to element-relative coordinates on every sync. */
  private absolutePoints: AbsoluteSample[] = [];
  private elementId: string | null = null;

  constructor(deps: FreedrawToolDeps) {
    super();
    this.deps = deps;
  }

  override onGestureStart(point: Point, modifiers: ModifierKeys, pressure?: number, pointerType?: string): void {
    const simulatePressure = NO_REAL_PRESSURE_POINTER_TYPES.has(pointerType ?? "mouse");
    const firstSample: AbsoluteSample = { x: point.x, y: point.y, pressure: pressure ?? DEFAULT_SIMULATED_PRESSURE };
    this.absolutePoints = [firstSample];
    this.deps.history.beginBatch();

    const style = this.deps.styleState.getStyle();
    const element: FreedrawElement = createFreedrawElement({
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
      points: [[0, 0, firstSample.pressure]],
      simulatePressure,
      strokeColor: style.strokeColor,
      strokeWidth: style.strokeWidth,
      opacity: style.opacity,
    });
    this.elementId = this.deps.scene.addElement(element).id;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `pointerType` kept to match `ToolHandler`'s signature (only relevant at gesture start, see `onGestureStart`)
  override onGestureMove(point: Point, modifiers: ModifierKeys, pressure?: number, pointerType?: string): void {
    if (!this.elementId) return;
    this.absolutePoints.push({ x: point.x, y: point.y, pressure: pressure ?? DEFAULT_SIMULATED_PRESSURE });
    this.syncElement();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `pointerType` kept to match `ToolHandler`'s signature
  override onGestureEnd(point: Point, modifiers: ModifierKeys, pressure?: number, pointerType?: string): void {
    if (!this.elementId) {
      this.reset();
      return;
    }
    this.absolutePoints.push({ x: point.x, y: point.y, pressure: pressure ?? DEFAULT_SIMULATED_PRESSURE });

    // A tap with no movement at all still commits — as a single-point dot (see module doc) — rather
    // than the zero-size-discard rule the drag-shape tools use; a tap is a deliberate mark, not an
    // accidental zero-size drag.
    const bounds = bboxOf(this.absolutePoints);
    if (bounds.width === 0 && bounds.height === 0) {
      this.commitDot();
    } else {
      this.syncElement();
    }

    this.deps.history.endBatch(this.deps.scene.getElements());
    this.reset();
  }

  /* eslint-disable @typescript-eslint/no-unused-vars -- `modifiers` kept to match `ToolHandler`'s signature */
  override onGestureCancel(modifiers: ModifierKeys): void {
    // No `history.cancelBatch()` here: the input pipeline already guarantees that for every abort
    // path — see `drag-shape-tool-base.ts`'s identical comment for the full rationale.
    if (this.elementId) this.deps.scene.deleteElement(this.elementId);
    this.reset();
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */

  /**
   * Commits a zero-movement tap as a single-point "dot": gives the element a minimal non-zero bbox
   * (radius derived from its own stroke width, via the same scale `freedraw-renderer.ts` uses for
   * paint) centered on the tap point, so culling/selection have a real hit target instead of a
   * degenerate zero-size box — a literal `[0, 0]`-sized element would never be visible or selectable.
   */
  private commitDot(): void {
    if (!this.elementId) return;
    const element = this.deps.scene.getElement(this.elementId);
    const sample = this.absolutePoints[0];
    if (!element || element.type !== "freedraw" || !sample) return;

    // Clamp the same way `freedraw-renderer.ts`'s `buildFreedrawStrokeOptions` clamps its
    // screen-space `size` — guards a caller-configurable `strokeWidth` of `0` from producing a
    // still-zero-radius (and therefore still-invisible/unselectable) dot.
    const radius = freedrawSceneRadius(Math.max(element.strokeWidth, 1));
    const changes: Partial<FreedrawElement> = {
      x: sample.x - radius,
      y: sample.y - radius,
      width: radius * 2,
      height: radius * 2,
      points: [[radius, radius, sample.pressure]],
    };
    this.deps.scene.updateElement(this.elementId, changes);
  }

  private syncElement(): void {
    if (!this.elementId) return;
    const bounds = bboxOf(this.absolutePoints);
    const relativePoints: FreedrawPoint[] = this.absolutePoints.map((point) => [
      point.x - bounds.x,
      point.y - bounds.y,
      point.pressure,
    ]);
    // `Scene.updateElement`'s `ElementUpdate` type only includes fields common to every `AnyElement`
    // member — `points`/`simulatePressure` are `FreedrawElement`-only, so a pre-typed
    // `Partial<FreedrawElement>` local is needed to pass them through; `Scene` itself just spreads
    // `changes`, so this is a type-level-only gap, not a runtime one (see `line-tool.ts`'s identical pattern).
    const changes: Partial<FreedrawElement> = { ...bounds, points: relativePoints };
    this.deps.scene.updateElement(this.elementId, changes);
  }

  private reset(): void {
    this.absolutePoints = [];
    this.elementId = null;
  }
}
