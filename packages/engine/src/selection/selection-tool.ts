/**
 * The select tool: one `ToolHandler` driving every selection/transform gesture — click/shift-click/
 * marquee selection, move (incl. alt-drag duplicate), 8-handle resize, rotate, plus every keyboard
 * action (`selection-tool-keyboard.ts`).
 *
 * This class is a thin dispatcher: `onGestureStart` hit-tests, in priority order, a handle on the
 * current selection's frame (resize/rotate) > an element under the pointer (move, expanding to its
 * group) > empty canvas (marquee), then delegates the whole gesture to one of the four composed
 * gesture classes (`selection-move-gesture.ts`, `selection-resize-gesture.ts`,
 * `selection-rotate-gesture.ts`, `selection-marquee-gesture.ts`) — each owns its own frozen
 * per-gesture state and history-batch lifecycle, split into separate files purely so each gesture's
 * math stays independently readable/testable rather than one large state machine.
 */
import type { AnyElement } from "../elements/element-types";
import { NoOpToolHandler } from "../input/tool-handler";
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";
import type { SceneRect } from "../render/viewport-culling";
import { topmostElementAt } from "./hit-test";
import { hitTestHandles } from "./resize-handles";
import { rotatePointAroundCenter } from "./selection-geometry";
import { MarqueeGesture } from "./selection-marquee-gesture";
import { MoveGesture } from "./selection-move-gesture";
import { ResizeGesture } from "./selection-resize-gesture";
import { RotateGesture } from "./selection-rotate-gesture";
import type { SelectionToolDeps } from "./selection-tool-deps";
import { buildSelectionFrame } from "./selection-tool-frame";
import { handleSelectionKeyDown } from "./selection-tool-keyboard";
import type { SnapGuide } from "./snapping";

export type { SelectionToolDeps } from "./selection-tool-deps";

type Mode = "idle" | "marquee" | "move" | "resize" | "rotate";

const HANDLE_HIT_PX = 8;
const ROTATE_HANDLE_OFFSET_PX = 28;
const CLICK_HIT_PX = 5;
/**
 * A pointer must travel at least this far (screen px, so divided by zoom in scene space) before a
 * resize/rotate/move gesture actually transforms anything. Resize and rotate map the pointer position
 * *directly* onto geometry, so grabbing a handle even a few px off its exact center and releasing
 * without dragging (most notably the second click of a double-click-to-edit landing inside a handle's
 * 8px hitbox) would otherwise snap the element to that offset — a visible jump/rescale on what the
 * user experienced as a click, not a drag. Gating apply() on real movement makes a click a no-op,
 * matching every mainstream editor. 4px mirrors the drag-vs-click threshold the line/arrow tools use.
 */
const DRAG_ACTIVATE_PX = 4;

export class SelectionTool extends NoOpToolHandler {
  private readonly deps: SelectionToolDeps;
  private readonly move: MoveGesture;
  private readonly resize: ResizeGesture;
  private readonly rotate: RotateGesture;
  private readonly marquee: MarqueeGesture;
  private mode: Mode = "idle";
  /** Pointer-down point of the in-flight gesture + whether it has crossed `DRAG_ACTIVATE_PX` yet — the "was this a real drag or just a click" gate for move/resize/rotate (see that constant's doc). Marquee is exempt: a zero-size marquee just selects nothing, no spurious transform. */
  private gestureStartPoint: Point | null = null;
  private dragActivated = false;

  constructor(deps: SelectionToolDeps) {
    super();
    this.deps = deps;
    this.move = new MoveGesture(deps);
    this.resize = new ResizeGesture(deps);
    this.rotate = new RotateGesture(deps);
    this.marquee = new MarqueeGesture(deps);
  }

  /** Once the pointer has moved `DRAG_ACTIVATE_PX` from the gesture's start, the drag is "real" and stays activated for the rest of the gesture. Returns the current activation state. */
  private updateDragActivation(point: Point): boolean {
    if (this.dragActivated) return true;
    if (!this.gestureStartPoint) return false;
    const dx = point.x - this.gestureStartPoint.x;
    const dy = point.y - this.gestureStartPoint.y;
    if (Math.hypot(dx, dy) >= DRAG_ACTIVATE_PX / this.deps.getZoom()) this.dragActivated = true;
    return this.dragActivated;
  }

  override onGestureStart(point: Point, modifiers: ModifierKeys): void {
    this.gestureStartPoint = point;
    this.dragActivated = false;
    const zoom = this.deps.getZoom();
    const selectedElements = [...this.deps.selection.getSelectedIds()]
      .map((id) => this.deps.scene.getElement(id))
      .filter((element): element is AnyElement => !!element);
    const frame = buildSelectionFrame(selectedElements);

    let insideSelectionBounds = false;
    if (frame) {
      const localPoint = rotatePointAroundCenter(point, frame.pivot, -frame.angle);
      const handle = hitTestHandles(frame.bounds, localPoint, HANDLE_HIT_PX / zoom, ROTATE_HANDLE_OFFSET_PX / zoom);
      if (handle === "rotate") {
        this.mode = "rotate";
        this.rotate.begin(point, frame);
        return;
      }
      if (handle) {
        this.mode = "resize";
        this.resize.begin(frame, handle);
        return;
      }
      const b = frame.bounds;
      insideSelectionBounds = localPoint.x >= b.x && localPoint.x <= b.x + b.width && localPoint.y >= b.y && localPoint.y <= b.y + b.height;
    }

    const hit = topmostElementAt(this.deps.scene, point, CLICK_HIT_PX / zoom);
    if (hit) {
      this.mode = this.move.begin(point, hit.id, modifiers) ? "move" : "idle";
      return;
    }

    // No element geometry was hit, but the pointer is inside the current selection's bounding box:
    // grab the whole selection to move it. Competitors let you drag from anywhere inside the selection
    // frame — not only precisely on the (often hairline or unfilled) geometry — which is what makes a
    // selected line/freehand feel easy to reposition. A no-drag click here keeps the selection (the
    // move gesture's finish cancels its empty batch), matching Excalidraw. Shift is stripped for
    // `begin` so an empty-interior grab never toggles the anchor out of the selection (that's a
    // shift-*click* on an element); axis-lock and alt-duplicate still apply via the move gesture.
    if (insideSelectionBounds && selectedElements.length > 0) {
      const anchorId = selectedElements[0]!.id;
      this.mode = this.move.begin(point, anchorId, { ...modifiers, shift: false }) ? "move" : "idle";
      return;
    }

    this.mode = "marquee";
    this.marquee.begin(point, modifiers);
  }

  override onGestureMove(point: Point, modifiers: ModifierKeys): void {
    if (this.mode === "marquee") {
      this.marquee.apply(point);
      return;
    }
    if (!this.updateDragActivation(point)) return; // a not-yet-a-drag click never transforms
    if (this.mode === "move") this.move.apply(point, modifiers);
    else if (this.mode === "resize") this.resize.apply(point, modifiers);
    else if (this.mode === "rotate") this.rotate.apply(point, modifiers);
  }

  override onGestureEnd(point: Point, modifiers: ModifierKeys): void {
    // Applies the transform at the final point first — a `pointerup` isn't guaranteed to land
    // exactly where the last `pointermove` did, so `finish()` must never rely solely on
    // whatever `apply()` last computed mid-drag (mirrors every drag-to-create tool's own
    // `onGestureEnd`, which recomputes from `(startPoint, point)` directly rather than trusting
    // the last `onGestureMove`).
    // A gesture can cross the drag threshold on the up-point alone (a fast flick with no intermediate
    // move events), so re-check here; if it never became a drag, skip apply() entirely and let each
    // gesture's finish() cancel its (empty) history batch — a click leaves geometry untouched.
    const dragged = this.updateDragActivation(point);
    if (this.mode === "marquee") this.marquee.finish(point, modifiers);
    else if (this.mode === "move") {
      if (dragged) this.move.apply(point, modifiers);
      this.move.finish();
    } else if (this.mode === "resize") {
      if (dragged) this.resize.apply(point, modifiers);
      this.resize.finish();
    } else if (this.mode === "rotate") {
      if (dragged) this.rotate.apply(point, modifiers);
      this.rotate.finish();
    }
    this.mode = "idle";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `modifiers` kept to match `ToolHandler`'s signature
  override onGestureCancel(modifiers: ModifierKeys): void {
    if (this.mode === "move") this.move.cancel();
    else if (this.mode === "resize") this.resize.cancel();
    else if (this.mode === "rotate") this.rotate.cancel();
    else if (this.mode === "marquee") this.marquee.reset();
    this.mode = "idle";
  }

  override onKeyDown(key: string, modifiers: ModifierKeys): void {
    handleSelectionKeyDown(this.deps, key, modifiers);
  }

  /** Live marquee rect (scene space) for `render/interactive-layer.ts` to draw, or `null` outside a marquee drag. */
  getMarqueeRect(): SceneRect | null {
    return this.mode === "marquee" ? this.marquee.getRect() : null;
  }

  /** Live object-snap alignment guides for the interactive layer, or `[]` outside a snapping move. */
  getSnapGuides(): readonly SnapGuide[] {
    return this.mode === "move" ? this.move.getSnapGuides() : [];
  }
}
