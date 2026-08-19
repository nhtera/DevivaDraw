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
import { computeGapSnap, computeGridSnap, computeObjectSnap } from "./snapping";
import { translateElements } from "./translate-elements";
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

/** A frozen snap reference: its bounds, plus the group it belongs to (gap snap treats a group as one object — see `collapseGroups`). */
interface SnapCandidate {
  bounds: SceneRect;
  groupId: string | undefined;
}

export class MoveGesture {
  private readonly deps: SelectionToolDeps;
  private startPoint: Point | null = null;
  private originalElements: Map<string, AnyElement> | null = null;
  private wasDuplicating = false;
  private preDuplicateSelectionIds: string[] | null = null;
  private snapGuides: readonly SnapGuide[] = [];
  /** Alignment references, frozen on the first move that wants them — see `snapCandidates`. */
  private frozenSnapCandidates: SceneRect[] | null = null;
  /** The same references with each group collapsed to one rect — see `collapseGroups`. Frozen alongside, so neither projection is rebuilt per pointer move. */
  private frozenGapCandidates: SceneRect[] | null = null;

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
        const threshold = SNAP_THRESHOLD_PX / this.deps.getZoom();
        if (this.frozenSnapCandidates === null) {
          const candidates = this.snapCandidates();
          this.frozenSnapCandidates = candidates.map((candidate) => candidate.bounds);
          this.frozenGapCandidates = collapseGroups(candidates);
        }
        const align = computeObjectSnap(movingBounds, this.frozenSnapCandidates, threshold);
        dx += align.dx;
        dy += align.dy;
        const guides = [...align.guides];

        // Equal spacing, only on an axis alignment did not already claim. Alignment is the stronger
        // intent, and a rule that picks whichever correction happens to be smaller is a canvas whose
        // behaviour the user cannot predict. Whether alignment claimed an axis is read off its
        // guides rather than off its delta, because a delta of 0 is also what "already aligned"
        // looks like — and stealing that axis for a gap snap would pull the shape back out of line.
        const alignedX = align.guides.some((guide) => guide.orientation === "vertical");
        const alignedY = align.guides.some((guide) => guide.orientation === "horizontal");
        if (!alignedX || !alignedY) {
          const gap = computeGapSnap({ ...movingBounds, x: movingBounds.x + align.dx, y: movingBounds.y + align.dy }, this.frozenGapCandidates ?? [], threshold);
          if (!alignedX && gap.dx !== 0) {
            dx += gap.dx;
            guides.push(...gap.guides.filter((guide) => guide.orientation === "horizontal"));
          }
          if (!alignedY && gap.dy !== 0) {
            dy += gap.dy;
            guides.push(...gap.guides.filter((guide) => guide.orientation === "vertical"));
          }
        }
        this.snapGuides = guides;
      }
    }

    // One notification for the whole selection, not one per element: this runs on every pointer
    // move, and a large selection made the per-element dispatch the dominant cost of the drag.
    const moving = this.originalElements;
    this.deps.scene.batch(() => translateElements(this.deps.scene, moving.values(), dx, dy));
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
  private snapCandidates(): SnapCandidate[] {
    const movingIds = new Set(this.originalElements?.keys() ?? []);
    const attachedArrowIds = new Set<string>();
    for (const element of this.originalElements?.values() ?? []) {
      for (const arrowId of boundArrowIds(element)) attachedArrowIds.add(arrowId);
    }
    const visible = this.deps.getVisibleSceneRect?.() ?? null;
    const candidates: SnapCandidate[] = [];
    for (const element of this.deps.scene.getElements()) {
      if (element.isDeleted || movingIds.has(element.id) || attachedArrowIds.has(element.id)) continue;
      if (visible && !elementIntersectsRect(element, visible)) continue;
      // The outermost group id, matching `expandToGroupMembers`: a nested group moves as its
      // outermost group, so that is the object gap snap should measure against.
      candidates.push({ bounds: elementBounds(element), groupId: element.groupIds[0] });
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
    this.frozenGapCandidates = null;
  }
}

/**
 * The alignment candidates, with every group collapsed into the union rect of its members.
 *
 * Alignment snap is right to work per element: lining up on one member of a group is a real intent,
 * and the guide drawn for it points at something the user can see. Gap snap is not. A group of three
 * stacked shapes has its own deliberate internal spacing, and offering that spacing to a shape being
 * dragged somewhere else proposes a distance copied from inside a thing the user is not interacting
 * with — appearing and vanishing as the drag crosses the group's region, which is the single biggest
 * source of gap-guide noise. A group is one object for the purpose of "how far apart are these".
 *
 * Derived from the already-frozen, already-viewport-filtered candidate list, once per gesture: this
 * is a second projection of the same search, never a wider one. A group half off screen therefore
 * collapses to the half that is on screen, which is also the only half the user could have been
 * spacing against.
 */
function collapseGroups(candidates: readonly SnapCandidate[]): SceneRect[] {
  const collapsed: SceneRect[] = [];
  const groupBounds = new Map<string, SceneRect>();
  for (const candidate of candidates) {
    if (candidate.groupId === undefined) {
      collapsed.push(candidate.bounds);
      continue;
    }
    const existing = groupBounds.get(candidate.groupId);
    groupBounds.set(candidate.groupId, existing === undefined ? candidate.bounds : unionRect(existing, candidate.bounds));
  }
  return [...collapsed, ...groupBounds.values()];
}

function unionRect(a: SceneRect, b: SceneRect): SceneRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
