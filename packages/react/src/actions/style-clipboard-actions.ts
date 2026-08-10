/**
 * Copy/paste *styles* (as opposed to whole elements): copy the style set of the selected element,
 * then paste it onto other selected elements — Excalidraw's Ctrl/Cmd+Alt+C / Ctrl/Cmd+Alt+V. The
 * copied style lives in a closure captured once per registry build (mirroring how `InternalClipboard`
 * holds copied *elements*): it is app-session state, not per-render, so a copy in one selection
 * survives until the next copy. Paste rewrites every selected element's style in one history batch —
 * the same "one batch per discrete user action" rule every other multi-element mutation follows.
 */
import { pickShapeStyle } from "@deviva-draw/engine";
import type { ShapeStyle } from "@deviva-draw/engine";
import type { Action, ActionRuntime } from "./action-types";

function firstSelected(runtime: ActionRuntime) {
  for (const id of runtime.selection.getSelectedIds()) {
    const element = runtime.scene.getElement(id);
    if (element && !element.isDeleted) return element;
  }
  return undefined;
}

export function buildStyleClipboardActions(): Action[] {
  let copied: ShapeStyle | null = null;
  return [
    {
      id: "copy-styles",
      labelKey: "action.copyStyles",
      icon: "copy",
      shortcut: "meta+alt+c",
      isEnabled: (runtime) => runtime.selection.size > 0,
      run: (runtime) => {
        const element = firstSelected(runtime);
        if (element) copied = pickShapeStyle(element);
      },
    },
    {
      id: "paste-styles",
      labelKey: "action.pasteStyles",
      icon: "paste",
      shortcut: "meta+alt+v",
      isEnabled: (runtime) => runtime.selection.size > 0 && copied !== null,
      run: (runtime) => {
        if (!copied) return;
        const ids = [...runtime.selection.getSelectedIds()];
        runtime.history.beginBatch();
        for (const id of ids) {
          const element = runtime.scene.getElement(id);
          if (element && !element.isDeleted) runtime.scene.updateElement(id, copied);
        }
        runtime.history.endBatch(runtime.scene.getElements());
      },
    },
  ];
}
