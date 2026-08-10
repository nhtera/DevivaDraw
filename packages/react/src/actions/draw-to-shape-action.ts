/**
 * "Draw to shape" (Shift+X): when a single freehand stroke is selected, replace it with the clean
 * shape the engine's `recognizeFreedrawShape` classifies it as (rectangle/ellipse/diamond/triangle/
 * line), at the same bounds and style. A no-op when the selection isn't exactly one freehand stroke,
 * or when nothing confident matches (the stroke is kept). One history batch.
 */
import { recognizeFreedrawShape } from "@deviva-draw/engine";
import type { Action, ActionRuntime } from "./action-types";

function singleSelectedFreedraw(runtime: ActionRuntime) {
  const ids = [...runtime.selection.getSelectedIds()];
  if (ids.length !== 1) return null;
  const element = runtime.scene.getElement(ids[0]!);
  return element && !element.isDeleted && element.type === "freedraw" ? element : null;
}

export function buildDrawToShapeActions(): Action[] {
  return [
    {
      id: "draw-to-shape",
      labelKey: "action.drawToShape",
      icon: "shapes",
      shortcut: "shift+x",
      isEnabled: (runtime) => singleSelectedFreedraw(runtime) !== null,
      run: (runtime) => {
        const stroke = singleSelectedFreedraw(runtime);
        if (!stroke) return;
        const shape = recognizeFreedrawShape(stroke);
        if (!shape) return;
        runtime.history.beginBatch();
        runtime.scene.deleteElement(stroke.id);
        runtime.scene.addElement(shape);
        runtime.history.endBatch(runtime.scene.getElements());
        runtime.selection.selectOnly([shape.id]);
      },
    },
  ];
}
