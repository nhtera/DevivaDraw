/**
 * Bucket-fill tool: click a closed shape to paint its background with the current fill color, the
 * affordance Excalidraw exposes as its `B` tool. The "current fill color" is `ShapeStyleState`'s
 * background — so the flow is: pick a background swatch in the properties panel, then click shapes to
 * apply it. A click on empty canvas or a non-fillable element (line/arrow/freedraw/text/image/frame)
 * is a no-op. Each click is one history batch (its own undo step); the tool stays active for repeated
 * filling (no `onCreated` hand-back), matching the eraser's "keep going" feel.
 */
import { NoOpToolHandler } from "../input/tool-handler";
import type { Point } from "../render/camera";
import type { Scene } from "../scene/scene";
import { topmostElementAt } from "../selection/hit-test";
import type { ShapeStyleState } from "./shape-style-state";
import type { ShapeToolHistory } from "./drag-shape-tool-base";

export interface BucketFillToolDeps {
  scene: Scene;
  styleState: ShapeStyleState;
  history: ShapeToolHistory;
  /** Current camera zoom — screen-pixel hit tolerance is converted to scene units through it, so the click target is equally forgiving at every zoom (same reasoning as the eraser/line tools). */
  getZoom(): number;
}

/** Screen-pixel radius around the click within which a fillable shape is targeted. */
const FILL_TOLERANCE_PX = 4;

/** Closed shapes whose interior a fill color makes sense on — excludes line/arrow/freedraw/text/image/frame/generic. */
const FILLABLE_TYPES: ReadonlySet<string> = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "triangle",
  "hexagon",
  "star",
  "parallelogram",
  "trapezoid",
  "cylinder",
  "double-circle",
  "block-arrow",
  "cloud",
  "heart",
  "x-box",
  "check-box",
  "note",
]);

export class BucketFillTool extends NoOpToolHandler {
  private readonly deps: BucketFillToolDeps;

  constructor(deps: BucketFillToolDeps) {
    super();
    this.deps = deps;
  }

  override onGestureStart(point: Point): void {
    const tolerance = FILL_TOLERANCE_PX / this.deps.getZoom();
    // Fill by clicking anywhere inside the shape, even an unfilled one — hence `interiorForClosedShapes`.
    const target = topmostElementAt(this.deps.scene, point, tolerance, { interiorForClosedShapes: true });
    if (!target || !FILLABLE_TYPES.has(target.type)) return;
    const fill = this.deps.styleState.getStyle().backgroundColor;
    if (target.backgroundColor === fill) return;
    this.deps.history.beginBatch();
    this.deps.scene.updateElement(target.id, { backgroundColor: fill });
    this.deps.history.endBatch(this.deps.scene.getElements());
  }
}
