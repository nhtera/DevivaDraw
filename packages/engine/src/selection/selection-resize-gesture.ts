/**
 * Resize-gesture state machine: freezes the selection frame + every member's original geometry at
 * gesture start, then on every move re-derives the new bounds from the *original* frame (never an
 * incremental delta) via `resize-handles.ts`'s pure math, mapping each member's own bounds
 * proportionally (`group-transform.ts`'s `mapBoundsToGroup`) before dispatching to its type-specific
 * update (`resize-dispatch.ts`). See `selection-tool.ts`'s module doc for how this composes with the
 * other gesture classes.
 *
 * Rotated-frame compensation: `computeResizedBounds` only keeps its anchor fixed in *local* space.
 * That's sufficient when `frame.angle === 0` (an unrotated element, or any multi-select — its frame
 * is always axis-aligned), but for a single rotated element every render rotates the box around its
 * *own current center* — and resizing moves that center (e.g. growing width shifts it sideways). A
 * numerically-unchanged local anchor point therefore lands at a *different world position* once
 * rotated around the shifted center, which is exactly the drift this class was found to have: resize
 * a 90deg-rotated rect from its `se` handle and the opposite (`nw`) corner visibly walks away instead
 * of staying put. The fix: compute the anchor's world position before and after the naive resize
 * (rotating around each bounds' own center by the same `frame.angle`), and translate the whole result
 * by the difference — translation commutes with rotation, so shifting the *entire* local box by a
 * fixed vector shifts its rotated image by that same vector, without touching the width/height
 * `computeResizedBounds` already decided on.
 */
import type { AnyElement } from "../elements/element-types";
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";
import type { SceneRect } from "../render/viewport-culling";
import { mapBoundsToGroup } from "./group-transform";
import { dispatchResize } from "./resize-dispatch";
import { computeResizedBounds, handlePositions, resizeAnchorPoint } from "./resize-handles";
import type { ResizeHandleId } from "./resize-handles";
import { rotatePointAroundCenter } from "./selection-geometry";
import type { SelectionToolDeps } from "./selection-tool-deps";
import type { SelectionFrame } from "./selection-tool-frame";

function boundsEqual(a: SceneRect, b: SceneRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function centerOf(bounds: SceneRect): Point {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

/**
 * Translates `newBounds` (already computed in local space by `computeResizedBounds`) so its resize
 * anchor's *world* position matches where it sat before the resize — see the module doc. A no-op
 * (returns `newBounds` unchanged, modulo float precision) whenever `angle === 0`, since an unrotated
 * anchor's world position already equals its local position regardless of which center it's "rotated"
 * around. `alt` (from-center) resizes need no correction either: their anchor *is* the center, which
 * `computeResizedBounds`'s own alt branch already keeps numerically fixed in local space, so the
 * before/after world positions come out equal without any translation.
 */
function compensateForRotatedAnchor(handle: ResizeHandleId, oldBounds: SceneRect, newBounds: SceneRect, angle: number, alt: boolean): SceneRect {
  if (angle === 0) return newBounds;
  const anchorLocal = alt ? centerOf(oldBounds) : resizeAnchorPoint(handle, oldBounds);
  const worldAnchorBefore = rotatePointAroundCenter(anchorLocal, centerOf(oldBounds), angle);
  const worldAnchorAfterNaive = rotatePointAroundCenter(anchorLocal, centerOf(newBounds), angle);
  const dx = worldAnchorBefore.x - worldAnchorAfterNaive.x;
  const dy = worldAnchorBefore.y - worldAnchorAfterNaive.y;
  return { ...newBounds, x: newBounds.x + dx, y: newBounds.y + dy };
}

export class ResizeGesture {
  private readonly deps: SelectionToolDeps;
  private frame: SelectionFrame | null = null;
  private handle: ResizeHandleId | null = null;
  private originalElements: Map<string, AnyElement> | null = null;
  private lastAppliedBounds: SceneRect | null = null;
  /** Local-space vector from the grabbed handle to where the pointer actually went down — see `begin`. */
  private grabOffset: Point = { x: 0, y: 0 };

  constructor(deps: SelectionToolDeps) {
    this.deps = deps;
  }

  /**
   * `grabPoint` is where the pointer actually went down (scene space). The resize math maps the pointer
   * *directly* onto the new corner/edge, so without recording how far the grab landed from the handle's
   * true position, the geometry snaps by that difference the instant the drag starts. That gap is now
   * always non-zero: handles are drawn on the padded selection frame (`inflateSelectionBounds`), a
   * `SELECTION_PADDING_PX` offset outward from the bounds this gesture resizes. Holding the offset also
   * removes the smaller, pre-existing jump from grabbing a handle a few px off its center.
   */
  begin(frame: SelectionFrame, handle: ResizeHandleId, grabPoint: Point): void {
    this.frame = frame;
    this.handle = handle;
    this.lastAppliedBounds = frame.bounds;
    const localGrab = rotatePointAroundCenter(grabPoint, frame.pivot, -frame.angle);
    const handleLocal = handlePositions(frame.bounds)[handle];
    this.grabOffset = { x: localGrab.x - handleLocal.x, y: localGrab.y - handleLocal.y };
    this.deps.history.beginBatch();
    this.originalElements = new Map(frame.members.map((member) => [member.id, this.deps.scene.getElement(member.id)!]));
  }

  apply(point: Point, modifiers: ModifierKeys): void {
    if (!this.frame || !this.handle || !this.originalElements) return;
    const rotated = rotatePointAroundCenter(point, this.frame.pivot, -this.frame.angle);
    const localPoint = { x: rotated.x - this.grabOffset.x, y: rotated.y - this.grabOffset.y };
    const rawNewBounds = computeResizedBounds(this.handle, this.frame.bounds, localPoint, modifiers);
    const newBounds = compensateForRotatedAnchor(this.handle, this.frame.bounds, rawNewBounds, this.frame.angle, modifiers.alt);
    this.lastAppliedBounds = newBounds;

    for (const member of this.frame.members) {
      const memberOldBounds = { x: member.x, y: member.y, width: member.width, height: member.height };
      const memberNewBounds = mapBoundsToGroup(memberOldBounds, this.frame.bounds, newBounds);
      // Dispatches against the *frozen original* element, not whatever `Scene` currently holds:
      // `dispatchResize` scales a line/arrow/freedraw's point array and a text's fontSize
      // *relative to the element it's given* — recomputing from scratch against the original on
      // every `apply()` call (this method is called once per `onGestureMove` and again in
      // `onGestureEnd`, always for the *same* absolute target bounds) keeps every call idempotent;
      // resizing from the live, already-partially-resized element would compound the scale factor
      // on every repeated call for the same drag instead of landing on the same final answer.
      const original = this.originalElements.get(member.id);
      if (!original) continue;
      const update = dispatchResize(original, memberOldBounds, memberNewBounds);
      if (update) this.deps.scene.updateElement(member.id, update);
    }
  }

  finish(): void {
    const unchanged = !this.frame || !this.lastAppliedBounds || boundsEqual(this.frame.bounds, this.lastAppliedBounds);
    if (unchanged) this.deps.history.cancelBatch();
    else this.deps.history.endBatch(this.deps.scene.getElements());
    this.reset();
  }

  cancel(): void {
    if (this.originalElements) {
      for (const original of this.originalElements.values()) this.deps.scene.updateElement(original.id, original);
    }
    this.reset();
  }

  private reset(): void {
    this.frame = null;
    this.handle = null;
    this.originalElements = null;
    this.lastAppliedBounds = null;
    this.grabOffset = { x: 0, y: 0 };
  }
}
