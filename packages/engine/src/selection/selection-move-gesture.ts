/**
 * Move-gesture state machine for the select tool: click-drag (whole selection as a unit), shift-click
 * add/remove/toggle, and alt-drag duplicate. Extracted from `selection-tool.ts` (which composes one
 * instance of this alongside the resize/rotate/marquee gesture classes) purely to keep each gesture's
 * state and math independently readable — see that file's module doc for the overall dispatch.
 */
import type { AnyElement } from "../elements/element-types";
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";
import { boundArrowIds } from "../bindings/binding-model";
import { dropArrowBindingsMovingAlone } from "./arrow-binding-drop";
import { duplicateElements } from "./clipboard";
import { expandMovingIdsWithFrameChildren } from "./frame-membership";
import { expandToGroupMembers } from "./group-ungroup";
import { selectionBoundsOf } from "./group-transform";
import { elementIntersectsRect } from "../render/viewport-culling";
import type { SceneRect } from "../render/viewport-culling";
import { elementBounds } from "./selection-geometry";
import type { SelectionToolDeps } from "./selection-tool-deps";
import { computeGridSnap, computeObjectSnap } from "./snapping";
import type { SnapGuide } from "./snapping";

/**
 * How near (screen px) an edge or centre has to come to another element's before the drag is pulled
 * onto it. This is a *capture* distance with no easing: entering the band moves the selection the
 * whole way in one frame, and the pointer then travels the band's full width again before the
 * selection resumes tracking it — a 1px-per-step sweep past one neighbour measures as
 * `1 1 1 1 1 1 9 0 0 …0 9 1 1 1`.
 *
 * That is why object snap is opt-in (`SelectionToolDeps.getObjectSnapEnabled`) rather than always on,
 * as it is in Excalidraw: when you want alignment the stickiness is the feature, and when you don't
 * it reads as the drag lagging and jumping. Grid snap has the same shape but is already gated behind
 * grid mode being switched on.
 */
const SNAP_THRESHOLD_PX = 8;

export class MoveGesture {
  private readonly deps: SelectionToolDeps;
  private startPoint: Point | null = null;
  private originalElements: Map<string, AnyElement> | null = null;
  private wasDuplicating = false;
  private preDuplicateSelectionIds: string[] | null = null;
  private snapGuides: readonly SnapGuide[] = [];
  private frozenSnapCandidates: SceneRect[] | null = null;

  constructor(deps: SelectionToolDeps) {
    this.deps = deps;
  }

  /** Resolves selection/shift/alt-duplicate semantics and opens the history batch. Returns `false` when a shift-click only toggled selection off — nothing to drag this gesture. */
  begin(point: Point, hitId: string, modifiers: ModifierKeys): boolean {
    const groupIds = expandToGroupMembers(this.deps.scene, [hitId]);
    const alreadySelected = this.deps.selection.isSelected(hitId);

    if (modifiers.shift) {
      if (alreadySelected) this.deps.selection.remove(groupIds);
      else this.deps.selection.add(groupIds);
      if (!this.deps.selection.isSelected(hitId)) return false;
    } else if (!alreadySelected) {
      this.deps.selection.selectOnly(groupIds);
    }

    this.startPoint = point;
    this.wasDuplicating = modifiers.alt;
    this.deps.history.beginBatch();
    const selectedIds = [...this.deps.selection.getSelectedIds()];

    if (modifiers.alt) {
      this.preDuplicateSelectionIds = selectedIds;
      this.deps.selection.selectOnly(duplicateElements(this.deps.scene, selectedIds, { dx: 0, dy: 0 }));
    } else {
      this.preDuplicateSelectionIds = null;
      // See `arrow-binding-drop.ts`'s module doc: an arrow moving alone drops its binding; an arrow
      // moving together with its bound shape (both co-selected here) keeps it.
      dropArrowBindingsMovingAlone(this.deps.scene, selectedIds);
    }

    // A frame drags its contents with it: expand the moving set to include every element contained in
    // any selected frame, without adding those elements to the visible selection (they follow, they
    // aren't "selected"). Bound text is excluded from this set — it repositions via its container's own
    // sync hook when the container moves.
    const movingIds = expandMovingIdsWithFrameChildren(this.deps.scene, [...this.deps.selection.getSelectedIds()]);
    this.originalElements = new Map(movingIds.map((id) => [id, this.deps.scene.getElement(id)!]));
    return true;
  }

  apply(point: Point, modifiers: ModifierKeys): void {
    if (!this.originalElements || !this.startPoint) return;
    let dx = point.x - this.startPoint.x;
    let dy = point.y - this.startPoint.y;
    if (modifiers.shift) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }

    const originals = [...this.originalElements.values()];
    const movingBounds = selectionBoundsOf(originals.map((element) => ({ ...element, x: element.x + dx, y: element.y + dy })));
    this.snapGuides = [];
    const grid = this.deps.getGrid?.();

    if (movingBounds) {
      if (grid?.enabled) {
        const correction = computeGridSnap(movingBounds, grid.size);
        dx += correction.dx;
        dy += correction.dy;
      } else if (this.deps.getObjectSnapEnabled?.()) {
        this.frozenSnapCandidates ??= this.snapCandidates();
        const snap = computeObjectSnap(movingBounds, this.frozenSnapCandidates, SNAP_THRESHOLD_PX / this.deps.getZoom());
        dx += snap.dx;
        dy += snap.dy;
        this.snapGuides = snap.guides;
      }
    }

    // One notification for the whole selection, not one per element: this runs on every pointer
    // move, and a large selection made the per-element dispatch the dominant cost of the drag.
    const moving = this.originalElements;
    this.deps.scene.batch(() => {
      for (const [id, original] of moving) this.deps.scene.updateElement(id, { x: original.x + dx, y: original.y + dy });
    });
  }

  /**
   * The elements this drag may align to: everything not being dragged, nothing scrolled off screen
   * (when the host tells us where the viewport is), and nothing whose own position follows the
   * dragged selection.
   *
   * The viewport filter is what the snap *means*, not an optimisation. An alignment the user cannot
   * see has no explanation: the shape lurches onto a column belonging to something outside the
   * window, and the guide drawn for it runs off the edge of the canvas. On a drawing any larger than
   * one screen that happens constantly, and reads as the drag blinking and jumping at random.
   * Excalidraw filters the same way — verified by scrolling a reference element out of view and
   * watching its snap stop applying.
   *
   * This runs once per gesture, on the first move that wants object snap, and the result is held in
   * `frozenSnapCandidates` for the rest of the drag. Candidates must not be re-read per move: an
   * arrow bound to the dragged shape reroutes on every `updateElement` (see
   * `bindings/binding-scene-sync.ts`), so live candidate bounds would include a target that tracks
   * the selection one frame behind — the shape then keeps getting pulled back to its own previous
   * position and only escapes in threshold-sized lurches. Excalidraw freezes references the same way
   * (its `SnapCache` of reference snap points, filled at drag start and cleared on pointer-up).
   *
   * Arrows bound to a moving element are dropped outright rather than frozen: even their drag-start
   * bounds are derived from the selection, so a guide to them aligns the shape with where its own
   * connector used to be — an alignment with no independent referent.
   */
  private snapCandidates(): SceneRect[] {
    const movingIds = new Set(this.originalElements?.keys() ?? []);
    const attachedArrowIds = new Set<string>();
    for (const element of this.originalElements?.values() ?? []) {
      for (const arrowId of boundArrowIds(element)) attachedArrowIds.add(arrowId);
    }
    const visible = this.deps.getVisibleSceneRect?.() ?? null;
    const candidates: SceneRect[] = [];
    for (const element of this.deps.scene.getElements()) {
      if (element.isDeleted || movingIds.has(element.id) || attachedArrowIds.has(element.id)) continue;
      if (visible && !elementIntersectsRect(element, visible)) continue;
      candidates.push(elementBounds(element));
    }
    return candidates;
  }

  finish(): void {
    const moved = this.originalElements
      ? [...this.originalElements.entries()].some(([id, original]) => {
          const element = this.deps.scene.getElement(id);
          return !!element && (element.x !== original.x || element.y !== original.y);
        })
      : false;
    if (!moved && !this.wasDuplicating) this.deps.history.cancelBatch();
    else this.deps.history.endBatch(this.deps.scene.getElements());
    this.reset();
  }

  cancel(): void {
    if (!this.originalElements) {
      this.reset();
      return;
    }
    if (this.wasDuplicating) {
      const duplicated = this.originalElements;
      // Batched for the same reason as every other multi-element loop here: cancelling a large
      // drag-duplicate would otherwise notify once per deleted element.
      this.deps.scene.batch(() => {
        for (const id of duplicated.keys()) this.deps.scene.deleteElement(id);
      });
      if (this.preDuplicateSelectionIds) this.deps.selection.selectOnly(this.preDuplicateSelectionIds);
    } else {
      const originals = this.originalElements;
      this.deps.scene.batch(() => {
        for (const original of originals.values()) this.deps.scene.updateElement(original.id, original);
      });
    }
    this.reset();
  }

  getSnapGuides(): readonly SnapGuide[] {
    return this.snapGuides;
  }

  private reset(): void {
    this.startPoint = null;
    this.originalElements = null;
    this.wasDuplicating = false;
    this.preDuplicateSelectionIds = null;
    this.snapGuides = [];
    this.frozenSnapCandidates = null;
  }
}
