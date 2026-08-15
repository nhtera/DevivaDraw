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
import { pointerRadiusMultiplier } from "../input/pointer-precision";
import type { Point } from "../render/camera";
import type { SceneRect } from "../render/viewport-culling";
import { topmostElementAt } from "./hit-test";
import { hitLinearHandle, linearHandleLayout } from "./linear-handles";
import { LinearPointGesture } from "./linear-point-gesture";
import { CLICK_HIT_PX, HANDLE_HIT_PX, ROTATE_HANDLE_OFFSET_PX, resizeCursorForHandle, selectionHoverCursor } from "./selection-cursor";
import { hitTestHandles, inflateSelectionBounds } from "./resize-handles";
import { rotatePointAroundCenter } from "./selection-geometry";
import { MarqueeGesture } from "./selection-marquee-gesture";
import { MoveGesture } from "./selection-move-gesture";
import { ResizeGesture } from "./selection-resize-gesture";
import { RotateGesture } from "./selection-rotate-gesture";
import type { SelectionToolDeps } from "./selection-tool-deps";
import { buildSelectionFrame, buildSelectionOverlay } from "./selection-tool-frame";
import { handleSelectionKeyDown } from "./selection-tool-keyboard";
import type { SnapGuide } from "./snapping";

export type { SelectionToolDeps } from "./selection-tool-deps";

type Mode = "idle" | "marquee" | "move" | "resize" | "rotate" | "linear-point";

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
  private readonly linearPoint: LinearPointGesture;
  private mode: Mode = "idle";
  /** Latest pointer position (scene space) — decides which of a selected arrow's segments offers its insert-a-bend dot. */
  private hoverPoint: Point | null = null;
  /** Pointer-down point of the in-flight gesture + whether it has crossed `DRAG_ACTIVATE_PX` yet — the "was this a real drag or just a click" gate for move/resize/rotate (see that constant's doc). Marquee is exempt: a zero-size marquee just selects nothing, no spurious transform. */
  private gestureStartPoint: Point | null = null;
  private dragActivated = false;
  /** What the pointer telegraphs (see `selection-cursor.ts`): recomputed per hover while idle, pinned per gesture otherwise. */
  private hoverCursor = "default";
  private gestureCursor = "default";

  constructor(deps: SelectionToolDeps) {
    super();
    this.deps = deps;
    this.move = new MoveGesture(deps);
    this.resize = new ResizeGesture(deps);
    this.rotate = new RotateGesture(deps);
    this.marquee = new MarqueeGesture(deps);
    this.linearPoint = new LinearPointGesture(deps);
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

  override onGestureStart(point: Point, modifiers: ModifierKeys, _pressure?: number, pointerType?: string): void {
    this.gestureStartPoint = point;
    this.dragActivated = false;
    const zoom = this.deps.getZoom();
    // Coarse pointers get proportionally wider precision targets — see `input/pointer-precision.ts`.
    const radiusMultiplier = pointerRadiusMultiplier(pointerType);
    const selectedElements = [...this.deps.selection.getSelectedIds()]
      .map((id) => this.deps.scene.getElement(id))
      .filter((element): element is AnyElement => !!element);
    // A lone selected arrow's vertex handles are hit-tested *first*, ahead of any resize handle. For
    // a two-point arrow no frame is drawn at all, so testing the frame's handles would leave
    // invisible grab zones where they used to be; for a bent arrow both are drawn, and dragging a
    // point is both the likelier intent and the one the vertex circle visibly promises.
    const overlay = buildSelectionOverlay(selectedElements);
    const handleArrow = overlay?.arrow ?? null;
    if (handleArrow) {
      const layout = linearHandleLayout(handleArrow, zoom, this.hoverPoint);
      const target = hitLinearHandle(layout, point, zoom, radiusMultiplier);
      if (target && this.linearPoint.begin(handleArrow, target, pointerType)) {
        this.mode = "linear-point";
        this.gestureCursor = "move";
        return;
      }
    }

    const frame = overlay?.kind === "bbox" ? overlay.frame : buildSelectionFrame(selectedElements);

    let insideSelectionBounds = false;
    if (frame) {
      const localPoint = rotatePointAroundCenter(point, frame.pivot, -frame.angle);
      // Resize/rotate handles exist only on the bbox overlay. A linear overlay draws none, so
      // hit-testing them would leave invisible grab zones exactly where they used to be — but the
      // *inside-the-bounds* grab below still applies, since a selected arrow should stay as easy to
      // reposition as a selected line.
      if (overlay?.kind === "bbox") {
        // Hit-test against the *padded* frame the interactive layer actually paints (see
        // `inflateSelectionBounds`); the resize/rotate gestures below still begin from the true `frame`.
        const handle = hitTestHandles(inflateSelectionBounds(frame.bounds, zoom), localPoint, HANDLE_HIT_PX / zoom, ROTATE_HANDLE_OFFSET_PX / zoom);
        if (handle === "rotate") {
          this.mode = "rotate";
          this.gestureCursor = "grabbing";
          this.rotate.begin(point, frame);
          return;
        }
        if (handle) {
          this.mode = "resize";
          this.gestureCursor = resizeCursorForHandle(handle, frame.angle);
          this.resize.begin(frame, handle, point);
          return;
        }
      }
      const b = frame.bounds;
      insideSelectionBounds = localPoint.x >= b.x && localPoint.x <= b.x + b.width && localPoint.y >= b.y && localPoint.y <= b.y + b.height;
    }

    const hit = topmostElementAt(this.deps.scene, point, CLICK_HIT_PX / zoom);
    if (hit) {
      this.mode = this.move.begin(point, hit.id, modifiers) ? "move" : "idle";
      this.gestureCursor = "move";
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
      this.gestureCursor = "move";
      return;
    }

    this.mode = "marquee";
    this.gestureCursor = "default";
    this.marquee.begin(point, modifiers);
  }

  override onGestureMove(point: Point, modifiers: ModifierKeys): void {
    if (this.mode === "marquee") {
      this.marquee.apply(point);
      return;
    }
    if (!this.updateDragActivation(point)) return; // a not-yet-a-drag click never transforms
    if (this.mode === "linear-point") this.linearPoint.apply(point, modifiers);
    else if (this.mode === "move") this.move.apply(point, modifiers);
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
    } else if (this.mode === "linear-point") {
      if (dragged) this.linearPoint.apply(point, modifiers);
      this.linearPoint.finish(point, modifiers);
    }
    this.mode = "idle";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `modifiers` kept to match `ToolHandler`'s signature
  override onGestureCancel(modifiers: ModifierKeys): void {
    if (this.mode === "move") this.move.cancel();
    else if (this.mode === "resize") this.resize.cancel();
    else if (this.mode === "rotate") this.rotate.cancel();
    else if (this.mode === "marquee") this.marquee.reset();
    else if (this.mode === "linear-point") this.linearPoint.cancel();
    this.mode = "idle";
  }

  override onKeyDown(key: string, modifiers: ModifierKeys): void {
    handleSelectionKeyDown(this.deps, key, modifiers);
  }

  /** Tracks the pointer between gestures so a selected arrow can offer the insert-a-bend dot on the segment nearest it, and refreshes the cursor telegraphing what a pointer-down here would do. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `modifiers` kept to match `ToolHandler`'s signature
  override onHover(point: Point, modifiers: ModifierKeys): void {
    this.hoverPoint = point;
    const selectedElements = [...this.deps.selection.getSelectedIds()]
      .map((id) => this.deps.scene.getElement(id))
      .filter((element): element is AnyElement => !!element);
    this.hoverCursor = selectionHoverCursor(this.deps.scene, selectedElements, point, this.deps.getZoom());
  }

  /** The pointer cursor the canvas should show right now: the hover feedback while idle, the in-flight gesture's own cursor otherwise. */
  getCursor(): string {
    return this.mode === "idle" ? this.hoverCursor : this.gestureCursor;
  }

  /** Latest pointer position for the overlay, or `null` before the pointer has been anywhere. */
  getHoverPoint(): Point | null {
    return this.hoverPoint;
  }

  /** Shapes the dragged arrow endpoint would attach to right now — the same halo the arrow tool shows while drawing. */
  getBindingAnchor(): Point | null {
    return this.mode === "linear-point" ? this.linearPoint.getBindingAnchor() : null;
  }

  getBindingHighlightIds(): readonly string[] {
    return this.mode === "linear-point" ? this.linearPoint.getBindingHighlightIds() : [];
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
