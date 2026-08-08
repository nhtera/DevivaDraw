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

export class SelectionTool extends NoOpToolHandler {
  private readonly deps: SelectionToolDeps;
  private readonly move: MoveGesture;
  private readonly resize: ResizeGesture;
  private readonly rotate: RotateGesture;
  private readonly marquee: MarqueeGesture;
  private mode: Mode = "idle";

  constructor(deps: SelectionToolDeps) {
    super();
    this.deps = deps;
    this.move = new MoveGesture(deps);
    this.resize = new ResizeGesture(deps);
    this.rotate = new RotateGesture(deps);
    this.marquee = new MarqueeGesture(deps);
  }

  override onGestureStart(point: Point, modifiers: ModifierKeys): void {
    const zoom = this.deps.getZoom();
    const selectedElements = [...this.deps.selection.getSelectedIds()]
      .map((id) => this.deps.scene.getElement(id))
      .filter((element): element is AnyElement => !!element);
    const frame = buildSelectionFrame(selectedElements);

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
    }

    const hit = topmostElementAt(this.deps.scene, point, CLICK_HIT_PX / zoom);
    if (hit) {
      this.mode = this.move.begin(point, hit.id, modifiers) ? "move" : "idle";
      return;
    }

    this.mode = "marquee";
    this.marquee.begin(point, modifiers);
  }

  override onGestureMove(point: Point, modifiers: ModifierKeys): void {
    if (this.mode === "marquee") this.marquee.apply(point);
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
    if (this.mode === "marquee") this.marquee.finish(point, modifiers);
    else if (this.mode === "move") {
      this.move.apply(point, modifiers);
      this.move.finish();
    } else if (this.mode === "resize") {
      this.resize.apply(point, modifiers);
      this.resize.finish();
    } else if (this.mode === "rotate") {
      this.rotate.apply(point, modifiers);
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
