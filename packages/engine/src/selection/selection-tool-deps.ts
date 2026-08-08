/**
 * Shared dependency shape for the select tool and every gesture class it composes
 * (`selection-move-gesture.ts`, `selection-resize-gesture.ts`, `selection-rotate-gesture.ts`,
 * `selection-tool-keyboard.ts`) — split into its own file so those siblings can import the type
 * without importing `selection-tool.ts` itself (which imports them), avoiding a module cycle.
 */
import type { Scene } from "../scene/scene";
import type { ShapeToolHistory } from "../tools/drag-shape-tool-base";
import type { InternalClipboard } from "./clipboard";
import type { SelectionState } from "./selection-state";

export interface SelectionToolDeps {
  scene: Scene;
  selection: SelectionState;
  history: ShapeToolHistory;
  clipboard: InternalClipboard;
  getZoom(): number;
  /** Live grid state; grid snap only applies while `enabled` — omit for a host with no grid UI yet (object snap still applies). */
  getGrid?(): { enabled: boolean; size: number };
}
