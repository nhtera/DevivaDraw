/**
 * Keyboard actions for the select tool: delete, arrow-key nudge, `Escape`-clears, select-all,
 * duplicate/copy/paste, group/ungroup, z-order. Split out from `selection-tool.ts` to keep that file
 * under the house line-count limit — every action here is a self-contained "resolve the selected ids,
 * call the right pure-math/cascade helper, batch it into one undo step" recipe, so extracting it loses
 * no cohesion. Registered as the select tool's `onKeyDown` fallback: any key that isn't already
 * consumed by `ShortcutRegistry`'s own tool-switch/pan-zoom bindings reaches here (see
 * `input/wheel-keyboard-controller.ts`'s module doc for that precedence) — none of the combos below
 * collide with the core registry's own (single-letter, no-modifier) tool shortcuts.
 */
import type { ModifierKeys } from "../input/tool-handler";
import type { Scene } from "../scene/scene";
import type { ShapeToolHistory } from "../tools/drag-shape-tool-base";
import { dropArrowBindingsMovingAlone } from "./arrow-binding-drop";
import { spawnConnectedNode } from "../bindings/spawn-connected-node";
import type { FlowSpawnDirection } from "../bindings/spawn-connected-node";
import { isBindableContainer } from "../text/bound-text";
import { duplicateElements, InternalClipboard } from "./clipboard";
import { deleteSelection } from "./delete-selection";
import { groupSelection, ungroupSelection } from "./group-ungroup";
import { lockSelection, unlockSelection } from "./selection-lock";
import type { SelectionState } from "./selection-state";
import { bringForward, bringToFront, sendBackward, sendToBack } from "./z-order-ops";

export interface SelectionKeyboardDeps {
  scene: Scene;
  selection: SelectionState;
  history: ShapeToolHistory;
  clipboard: InternalClipboard;
}

/** Scene units nudged per arrow-key press; `shift` multiplies it for a coarser step. */
const NUDGE_STEP = 1;
const NUDGE_STEP_SHIFT = 10;

const NUDGE_DIRECTION: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function withMetaOrCtrl(modifiers: ModifierKeys): boolean {
  return modifiers.ctrl || modifiers.meta;
}

function runBatched(deps: SelectionKeyboardDeps, mutate: () => void): void {
  deps.history.beginBatch();
  mutate();
  deps.history.endBatch(deps.scene.getElements());
}

function selectAll(deps: SelectionKeyboardDeps): void {
  const ids = deps.scene
    .getElements()
    .filter((element) => !element.isDeleted && !element.locked && !(element.type === "text" && element.containerId !== null))
    .map((element) => element.id);
  deps.selection.selectOnly(ids);
}

function nudgeSelection(deps: SelectionKeyboardDeps, key: string, shiftHeld: boolean): void {
  const direction = NUDGE_DIRECTION[key];
  const ids = [...deps.selection.getSelectedIds()];
  if (!direction || ids.length === 0) return;
  const step = shiftHeld ? NUDGE_STEP_SHIFT : NUDGE_STEP;
  runBatched(deps, () => {
    // Same policy as a mouse-drag move — see `arrow-binding-drop.ts`'s module doc: an arrow nudged
    // alone drops its binding (otherwise it'd sit at a stale attachment point with nothing left to
    // ever reroute it back); nudged together with its bound shape, both travel in lockstep and the
    // binding survives.
    dropArrowBindingsMovingAlone(deps.scene, ids);
    for (const id of ids) {
      const element = deps.scene.getElement(id);
      if (element) deps.scene.updateElement(id, { x: element.x + direction[0] * step, y: element.y + direction[1] * step });
    }
  });
}

/** Dispatches a resolved keyboard action for the currently selected ids. No-op for any key this tool doesn't own. */
export function handleSelectionKeyDown(deps: SelectionKeyboardDeps, key: string, modifiers: ModifierKeys): void {
  const ids = [...deps.selection.getSelectedIds()];
  const meta = withMetaOrCtrl(modifiers);
  const lower = key.length === 1 ? key.toLowerCase() : key;

  if ((key === "Delete" || key === "Backspace") && ids.length > 0) {
    runBatched(deps, () => deleteSelection(deps.scene, ids));
    deps.selection.clear();
    return;
  }
  if (key === "Escape") {
    deps.selection.clear();
    return;
  }
  if (meta && lower === "a") {
    selectAll(deps);
    return;
  }
  if (meta && lower === "d" && ids.length > 0) {
    let newIds: string[] = [];
    runBatched(deps, () => {
      newIds = duplicateElements(deps.scene, ids);
    });
    deps.selection.selectOnly(newIds);
    return;
  }
  if (meta && lower === "c" && ids.length > 0) {
    deps.clipboard.copy(deps.scene, ids);
    return;
  }
  if (meta && lower === "x" && ids.length > 0) {
    // Cut = copy + delete in one undo step; the copy runs before the delete so the clipboard holds
    // the elements as they were, not tombstones.
    deps.clipboard.copy(deps.scene, ids);
    runBatched(deps, () => deleteSelection(deps.scene, ids));
    deps.selection.clear();
    return;
  }
  if (meta && lower === "v" && deps.clipboard.hasContent()) {
    let newIds: string[] = [];
    runBatched(deps, () => {
      newIds = deps.clipboard.paste(deps.scene);
    });
    if (newIds.length > 0) deps.selection.selectOnly(newIds);
    return;
  }
  if (meta && modifiers.shift && lower === "g" && ids.length > 0) {
    runBatched(deps, () => ungroupSelection(deps.scene, ids));
    return;
  }
  if (meta && lower === "g" && ids.length > 1) {
    runBatched(deps, () => groupSelection(deps.scene, ids));
    return;
  }
  if (meta && modifiers.shift && lower === "l" && ids.length > 0) {
    // Toggle: any unlocked element in the selection -> lock the whole selection; all-already-locked -> unlock it.
    const anyUnlocked = ids.some((id) => deps.scene.getElement(id)?.locked === false);
    runBatched(deps, () => (anyUnlocked ? lockSelection : unlockSelection)(deps.scene, ids));
    return;
  }
  if (key === "]" && ids.length > 0) {
    runBatched(deps, () => (meta ? bringToFront : bringForward)(deps.scene, ids));
    return;
  }
  if (key === "[" && ids.length > 0) {
    runBatched(deps, () => (meta ? sendToBack : sendBackward)(deps.scene, ids));
    return;
  }
  if (key in NUDGE_DIRECTION) {
    // Alt+Arrow with a single bindable shape selected grows a flowchart: a connected sibling node
    // spawns in that direction and becomes the selection, so repeated presses keep chaining. Plain
    // arrows stay the pixel nudge.
    const flowSource = modifiers.alt && ids.length === 1 ? deps.scene.getElement(ids[0]!) : undefined;
    if (flowSource && isBindableContainer(flowSource)) {
      let nodeId: string | null = null;
      runBatched(deps, () => {
        nodeId = spawnConnectedNode(deps.scene, flowSource.id, FLOW_DIRECTION_BY_KEY[key]!);
      });
      if (nodeId !== null) deps.selection.selectOnly([nodeId]);
      return;
    }
    // Alt on a non-bindable selection (text, arrow, image, ...) falls through to the ordinary nudge.
    nudgeSelection(deps, key, modifiers.shift);
  }
}

const FLOW_DIRECTION_BY_KEY: Record<string, FlowSpawnDirection> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};
