/**
 * Undo/redo + selection-editing actions (copy/paste/duplicate/delete/select-all) — the toolbar/
 * top-bar/context-menu/command-palette entry points for the exact same engine primitives
 * `@deviva-draw/engine`'s `selection/selection-tool-keyboard.ts` already wires to keyboard shortcuts.
 * Deliberately re-implemented as direct engine calls here (not by simulating a keydown event) since
 * an action triggered by a mouse click has no keyboard event to synthesize — both paths converge on
 * the same underlying `Scene`/`SelectionState`/`InternalClipboard` mutations either way.
 */
import { deleteSelection, duplicateElements } from "@deviva-draw/engine";
import type { Action, ActionRuntime } from "./action-types";

function hasSelection(runtime: ActionRuntime): boolean {
  return runtime.selection.size > 0;
}

/** Same "selectable" predicate `selection-tool-keyboard.ts`'s local `selectAll` uses: skip deleted, locked, and bound-text elements (bound text is never independently selectable — see `hit-test.ts`'s doc). */
function selectAllIds(runtime: ActionRuntime): string[] {
  return runtime.scene
    .getElements()
    .filter((element) => !element.isDeleted && !element.locked && !(element.type === "text" && element.containerId !== null))
    .map((element) => element.id);
}

function runBatched(runtime: ActionRuntime, mutate: () => void): void {
  runtime.history.beginBatch();
  mutate();
  runtime.history.endBatch(runtime.scene.getElements());
}

export function buildEditActions(): Action[] {
  return [
    {
      id: "undo",
      labelKey: "action.undo",
      icon: "undo",
      shortcut: "meta+z",
      isEnabled: (runtime) => runtime.history.canUndo(),
      run: (runtime) => {
        const snapshot = runtime.history.undo();
        if (!snapshot) return;
        runtime.scene.loadElementsSnapshot(snapshot);
        runtime.selection.clear();
      },
    },
    {
      id: "redo",
      labelKey: "action.redo",
      icon: "redo",
      shortcut: "meta+shift+z",
      isEnabled: (runtime) => runtime.history.canRedo(),
      run: (runtime) => {
        const snapshot = runtime.history.redo();
        if (!snapshot) return;
        runtime.scene.loadElementsSnapshot(snapshot);
        runtime.selection.clear();
      },
    },
    {
      id: "select-all",
      labelKey: "action.selectAll",
      icon: "select-all",
      shortcut: "meta+a",
      run: (runtime) => runtime.selection.selectOnly(selectAllIds(runtime)),
    },
    {
      id: "copy",
      labelKey: "action.copy",
      icon: "copy",
      shortcut: "meta+c",
      isEnabled: hasSelection,
      run: (runtime) => runtime.clipboard.copy(runtime.scene, [...runtime.selection.getSelectedIds()]),
    },
    {
      id: "paste",
      labelKey: "action.paste",
      icon: "paste",
      shortcut: "meta+v",
      isEnabled: (runtime) => runtime.clipboard.hasContent(),
      run: (runtime) => {
        let newIds: string[] = [];
        runBatched(runtime, () => (newIds = runtime.clipboard.paste(runtime.scene)));
        if (newIds.length > 0) runtime.selection.selectOnly(newIds);
      },
    },
    {
      id: "duplicate",
      labelKey: "action.duplicate",
      icon: "duplicate",
      shortcut: "meta+d",
      isEnabled: hasSelection,
      run: (runtime) => {
        const ids = [...runtime.selection.getSelectedIds()];
        let newIds: string[] = [];
        runBatched(runtime, () => (newIds = duplicateElements(runtime.scene, ids)));
        runtime.selection.selectOnly(newIds);
      },
    },
    {
      id: "delete",
      labelKey: "action.delete",
      icon: "trash",
      shortcut: "delete",
      isEnabled: hasSelection,
      run: (runtime) => {
        const ids = [...runtime.selection.getSelectedIds()];
        runBatched(runtime, () => deleteSelection(runtime.scene, ids));
        runtime.selection.clear();
      },
    },
  ];
}
