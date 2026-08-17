/**
 * Rubber-band marquee-gesture state machine: tracks the live drag rect for `render/interactive-layer.ts`
 * to draw, and resolves the final hit set (expanded to whole groups) on gesture end. Never touches
 * `Scene`/history — a marquee only ever mutates ephemeral `SelectionState`, not persisted data, so
 * there is nothing to batch or roll back on abort (a cancelled marquee just leaves the selection as it
 * was going in — see `selection-tool.ts`'s `onGestureCancel`, which no-ops for this mode entirely).
 */
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";
import type { SceneRect } from "../render/viewport-culling";
import { expandToGroupMembers } from "./group-ungroup";
import { elementsInMarquee, normalizeMarqueeRect, resolveMarqueeMode } from "./marquee-select";
import type { SelectionToolDeps } from "./selection-tool-deps";

export class MarqueeGesture {
  private readonly deps: SelectionToolDeps;
  private startPoint: Point | null = null;
  private currentPoint: Point | null = null;

  constructor(deps: SelectionToolDeps) {
    this.deps = deps;
  }

  begin(point: Point, modifiers: ModifierKeys): void {
    if (!modifiers.shift) this.deps.selection.clear();
    this.startPoint = point;
    this.currentPoint = point;
  }

  apply(point: Point): void {
    this.currentPoint = point;
  }

  finish(point: Point, modifiers: ModifierKeys): void {
    if (!this.startPoint) return;
    const rect = normalizeMarqueeRect(this.startPoint, point);
    // Drag direction picks the mode by default: right-to-left ("backwards") is the precise "fully
    // enclosed only" gesture, left-to-right is the forgiving "anything touched" one — the established
    // convention this genre of app uses. The "select on" preference can override that convention in
    // either direction; it defaults to `"auto"`, which preserves it exactly.
    const mode = resolveMarqueeMode(this.deps.getSelectOnMode?.() ?? "auto", point.x < this.startPoint.x);

    const expanded = new Set<string>();
    for (const hit of elementsInMarquee(this.deps.scene.selectableElements(), rect, mode)) {
      for (const id of expandToGroupMembers(this.deps.scene, [hit.id])) expanded.add(id);
    }
    if (modifiers.shift) this.deps.selection.add(expanded);
    else if (expanded.size > 0) this.deps.selection.selectOnly(expanded);

    this.reset();
  }

  /** Live drag rect (scene space) for the interactive layer, or `null` outside a marquee drag. */
  getRect(): SceneRect | null {
    if (!this.startPoint || !this.currentPoint) return null;
    return normalizeMarqueeRect(this.startPoint, this.currentPoint);
  }

  reset(): void {
    this.startPoint = null;
    this.currentPoint = null;
  }
}
