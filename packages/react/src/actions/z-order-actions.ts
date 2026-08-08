/** Z-order actions — thin wrappers around `@deviva-draw/engine`'s `selection/z-order-ops.ts`, batched into one undo step each. */
import { bringForward, bringToFront, sendBackward, sendToBack } from "@deviva-draw/engine";
import type { Action, ActionRuntime } from "./action-types";

function hasSelection(runtime: ActionRuntime): boolean {
  return runtime.selection.size > 0;
}

function zOrderAction(id: string, labelKey: Action["labelKey"], icon: string, shortcut: string, apply: typeof bringToFront): Action {
  return {
    id,
    labelKey,
    icon,
    shortcut,
    isEnabled: hasSelection,
    run: (runtime) => {
      const ids = [...runtime.selection.getSelectedIds()];
      runtime.history.beginBatch();
      apply(runtime.scene, ids);
      runtime.history.endBatch(runtime.scene.getElements());
    },
  };
}

export function buildZOrderActions(): Action[] {
  return [
    zOrderAction("bring-to-front", "action.bringToFront", "layer-front", "meta+]", bringToFront),
    zOrderAction("bring-forward", "action.bringForward", "layer-up", "]", bringForward),
    zOrderAction("send-backward", "action.sendBackward", "layer-down", "[", sendBackward),
    zOrderAction("send-to-back", "action.sendToBack", "layer-back", "meta+[", sendToBack),
  ];
}
