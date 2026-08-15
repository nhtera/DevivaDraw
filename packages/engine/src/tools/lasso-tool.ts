/**
 * Lasso selection tool: drag to trace a free-form loop; on release, every element the loop catches
 * (see `selection/lasso-select.ts`) becomes selected, expanded to whole groups the same way the
 * rubber-band marquee does. Purely a selection gesture — it never touches `Scene` or history (nothing
 * to undo), so an aborted drag (Escape/blur) just drops the in-progress path and leaves the selection
 * as it was. Shift keeps the existing selection and adds to it; without shift the loop replaces it.
 *
 * The live path is exposed via `getPath()` for the interactive overlay to draw each frame — the same
 * "tool owns the ephemeral geometry, render loop reads it" split the laser pointer uses.
 */
import { NoOpToolHandler } from "../input/tool-handler";
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";
import { expandToGroupMembers } from "../selection/group-ungroup";
import { elementsInLasso } from "../selection/lasso-select";
import type { Scene } from "../scene/scene";
import type { SelectionState } from "../selection/selection-state";

export interface LassoToolDeps {
  scene: Scene;
  selection: SelectionState;
}

export class LassoTool extends NoOpToolHandler {
  private readonly deps: LassoToolDeps;
  private points: Point[] = [];
  private active = false;

  constructor(deps: LassoToolDeps) {
    super();
    this.deps = deps;
  }

  override onGestureStart(point: Point, modifiers: ModifierKeys): void {
    this.active = true;
    this.points = [point];
    // Match the marquee: a plain lasso replaces the selection (cleared up front so an empty loop
    // deselects); a shift-lasso adds to it.
    if (!modifiers.shift) this.deps.selection.clear();
  }

  override onGestureMove(point: Point): void {
    if (!this.active) return;
    this.points.push(point);
  }

  override onGestureEnd(point: Point, modifiers: ModifierKeys): void {
    if (!this.active) return;
    this.points.push(point);

    const expanded = new Set<string>();
    for (const hit of elementsInLasso(this.deps.scene.selectableElements(), this.points)) {
      for (const id of expandToGroupMembers(this.deps.scene, [hit.id])) expanded.add(id);
    }
    if (modifiers.shift) this.deps.selection.add(expanded);
    else if (expanded.size > 0) this.deps.selection.selectOnly(expanded);

    this.reset();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `modifiers` kept to match `ToolHandler`'s signature
  override onGestureCancel(modifiers: ModifierKeys): void {
    this.reset();
  }

  /** The in-progress loop (scene space), or `[]` when idle — read by the interactive layer to draw the live lasso outline. */
  getPath(): readonly Point[] {
    return this.points;
  }

  private reset(): void {
    this.active = false;
    this.points = [];
  }
}
