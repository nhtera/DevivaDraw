/**
 * Proves the tool-switch contract works for the default/most-used tool, without implementing real
 * hit-testing or a selection model yet — that lands once selection exists. This phase draws no
 * marquee-select rectangle and does not know which elements exist under the cursor, so the only
 * concrete behavior it can honestly promise is: a completed gesture in this tool (there is nothing
 * to hit-test against yet, so every gesture in this stub is definitionally "on empty canvas") clears
 * whatever selection state the caller currently has.
 */
import type { Point } from "../render/camera";
import { NoOpToolHandler } from "./tool-handler";
import type { ModifierKeys } from "./tool-handler";

export interface SelectionToolSkeletonDeps {
  /** Called once per completed gesture (click) — deselects the caller's (future) selection state. */
  onEmptyCanvasClick?: () => void;
}

export class SelectionToolSkeleton extends NoOpToolHandler {
  private readonly deps: SelectionToolSkeletonDeps;

  constructor(deps: SelectionToolSkeletonDeps = {}) {
    super();
    this.deps = deps;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- params kept to match `ToolHandler`'s signature
  override onGestureEnd(point: Point, modifiers: ModifierKeys): void {
    this.deps.onEmptyCanvasClick?.();
  }
}
