/**
 * Undo/redo + selection-editing actions (copy/paste/duplicate/delete/select-all) — the toolbar/
 * top-bar/context-menu/command-palette entry points for the exact same engine primitives
 * `@deviva-draw/engine`'s `selection/selection-tool-keyboard.ts` already wires to keyboard shortcuts.
 * Deliberately re-implemented as direct engine calls here (not by simulating a keydown event) since
 * an action triggered by a mouse click has no keyboard event to synthesize — both paths converge on
 * the same underlying `Scene`/`SelectionState`/`InternalClipboard` mutations either way.
 */
import { deleteSelection, duplicateElements, FONT_SIZE_LEVELS } from "@deviva-draw/engine";
import type { AnyElement } from "@deviva-draw/engine";
import type { Action, ActionRuntime } from "./action-types";

function hasSelection(runtime: ActionRuntime): boolean {
  return runtime.selection.size > 0;
}

/** Selected text elements, plus a container's bound label — so stepping the size works on a selected sticky note/labelled shape too, not only on bare text. */
function fontSizeTargets(runtime: ActionRuntime): string[] {
  const ids = new Set<string>();
  for (const id of runtime.selection.getSelectedIds()) {
    const element = runtime.scene.getElement(id);
    if (!element || element.isDeleted) continue;
    if (element.type === "text") ids.add(element.id);
    for (const ref of element.boundElements ?? []) {
      const bound = runtime.scene.getElement(ref.id);
      if (bound && bound.type === "text" && !bound.isDeleted) ids.add(bound.id);
    }
  }
  return [...ids];
}

/** Steps every target's `fontSize` to the neighboring `S/M/L/XL` preset — the same ladder the panel's size buttons use, so the shortcut and the buttons can never disagree about what sizes exist. */
function stepFontSize(runtime: ActionRuntime, direction: 1 | -1): void {
  const targets = fontSizeTargets(runtime);
  if (targets.length === 0) return;
  const levels = Object.values(FONT_SIZE_LEVELS);
  runtime.history.beginBatch();
  for (const id of targets) {
    const element = runtime.scene.getElement(id);
    if (!element || element.type !== "text") continue;
    // Nearest preset at or beyond the current size, so a hand-set in-between value still steps sanely.
    const currentIndex = levels.findIndex((level) => level >= element.fontSize);
    const baseIndex = currentIndex === -1 ? levels.length - 1 : currentIndex;
    const nextIndex = Math.max(0, Math.min(levels.length - 1, baseIndex + direction));
    if (levels[nextIndex] !== element.fontSize) {
      // Typed through the distributive `Partial<AnyElement>` (as the properties panel does) — the
      // non-distributive `Omit` in `updateElement`'s own parameter keeps union-only keys out of a bare literal.
      const changes: Partial<AnyElement> = { fontSize: levels[nextIndex] };
      runtime.scene.updateElement(id, changes);
    }
  }
  runtime.history.endBatch(runtime.scene.getElements());
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
      id: "cut",
      labelKey: "action.cut",
      icon: "copy",
      shortcut: "meta+x",
      isEnabled: hasSelection,
      run: (runtime) => {
        const ids = [...runtime.selection.getSelectedIds()];
        // Copy before delete, so the clipboard holds the live elements rather than tombstones.
        runtime.clipboard.copy(runtime.scene, ids);
        runBatched(runtime, () => deleteSelection(runtime.scene, ids));
        runtime.selection.clear();
      },
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
      id: "increase-font-size",
      labelKey: "action.increaseFontSize",
      icon: "text",
      shortcut: "meta+shift+>",
      isEnabled: (runtime) => fontSizeTargets(runtime).length > 0,
      run: (runtime) => stepFontSize(runtime, 1),
    },
    {
      id: "decrease-font-size",
      labelKey: "action.decreaseFontSize",
      icon: "text",
      shortcut: "meta+shift+<",
      isEnabled: (runtime) => fontSizeTargets(runtime).length > 0,
      run: (runtime) => stepFontSize(runtime, -1),
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
