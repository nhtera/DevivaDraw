/**
 * Shared dependency shape for the select tool and every gesture class it composes
 * (`selection-move-gesture.ts`, `selection-resize-gesture.ts`, `selection-rotate-gesture.ts`,
 * `selection-tool-keyboard.ts`) — split into its own file so those siblings can import the type
 * without importing `selection-tool.ts` itself (which imports them), avoiding a module cycle.
 */
import type { SceneRect } from "../render/viewport-culling";
import type { SelectOnMode } from "./marquee-select";
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
  /** How a marquee drag decides what it selects. `"auto"` (the default when omitted) keeps the drag-direction convention — see `marquee-select.ts`'s `SelectOnMode`. */
  getSelectOnMode?(): SelectOnMode;
  /**
   * Whether dragging an arrow endpoint may attach it to a shape. `true` when omitted — binding is
   * the default behavior, and a host with no preference UI must not silently lose it. Turning it off
   * never *un*binds anything: existing bindings keep tracking their shapes, since the preference
   * governs only whether a gesture may create a new one.
   */
  getBindingEnabled?(): boolean;
  /** Whether an endpoint may snap onto a shape's edge midpoints (its connection anchors). `true` when omitted. Independent of `getObjectSnapEnabled` — these are binding anchors, not alignment guides. */
  getMidpointSnapEnabled?(): boolean;
}
