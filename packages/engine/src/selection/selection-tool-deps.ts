/**
 * Shared dependency shape for the select tool and every gesture class it composes
 * (`selection-move-gesture.ts`, `selection-resize-gesture.ts`, `selection-rotate-gesture.ts`,
 * `selection-tool-keyboard.ts`) — split into its own file so those siblings can import the type
 * without importing `selection-tool.ts` itself (which imports them), avoiding a module cycle.
 */
import type { SceneRect } from "../render/viewport-culling";
import type { Scene } from "../scene/scene";
import type { TextMeasurer } from "../text/text-measurement";
import type { ShapeToolHistory } from "../tools/drag-shape-tool-base";
import type { InternalClipboard } from "./clipboard";
import type { SelectionState } from "./selection-state";

export interface SelectionToolDeps {
  scene: Scene;
  selection: SelectionState;
  history: ShapeToolHistory;
  clipboard: InternalClipboard;
  getZoom(): number;
  /**
   * Text measurer for commit-time layout work inside gestures — today: re-fitting a resized table's
   * row heights to its wrapped cell text when the gesture finishes (never per-frame; see
   * `elements/table-layout.ts`'s `fitRowHeightsToText`). Optional: a host without one skips the
   * re-fit and the table just keeps its proportionally-scaled rows.
   */
  textMeasurer?: TextMeasurer;
  /** Live grid state; grid snap only applies while `enabled` — omit for a host with no grid UI yet. */
  getGrid?(): { enabled: boolean; size: number };
  /**
   * Whether align-to-other-elements snapping is switched on. Off when omitted, matching Excalidraw's
   * own default: a snap that is always on makes every drag sticky, and a host with no preference UI
   * would have no way to turn it off. See `selection-move-gesture.ts` for what being sticky costs.
   */
  getObjectSnapEnabled?(): boolean;
  /**
   * The scene rect currently on screen. Object snap only aligns to elements inside it — a drag must
   * never be pulled onto something the user cannot see. Omit and every element in the scene counts,
   * which is only safe for a host that keeps the whole drawing in view.
   */
  getVisibleSceneRect?(): SceneRect | null;
}
