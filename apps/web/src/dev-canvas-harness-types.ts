/**
 * Shared types for the dev harness's runtime wiring — split out of `dev-canvas-harness-runtime.ts`
 * purely to keep that file under the house line-count limit.
 */
import type { SceneRect, SelectionState, SnapGuide, TextEditSession, ToolStateMachine } from "@deviva-draw/engine";

/** Live grid-mode state — a plain mutable object (not React state) so the render loop and `SelectionTool`'s snap-to-grid both read the exact same live value every frame without a subscription. */
export interface GridState {
  enabled: boolean;
  size: number;
}

export interface DevCanvasHarnessRuntime {
  toolStateMachine: ToolStateMachine;
  editSession: TextEditSession;
  /** Selection ids for the select tool — read by the render loop each frame to resolve the interactive layer's overlay content. */
  selectionState: SelectionState;
  grid: GridState;
  /** Live rubber-band marquee rect (scene space) for the interactive layer to draw, or `null` outside a marquee drag. */
  getMarqueeRect(): SceneRect | null;
  /** Live object-snap alignment guides for the interactive layer, or `[]` outside a snapping move. */
  getSnapGuides(): readonly SnapGuide[];
  /** Detaches the pointer pipeline and the double-click listener — call from the owning effect's cleanup. */
  dispose(): void;
}
