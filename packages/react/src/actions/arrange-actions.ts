/**
 * Align/distribute/group/ungroup/lock actions — align/distribute compute pure `{id, changes}` pairs
 * via `@deviva-draw/engine`'s `selection/align-distribute.ts` and apply them as one batched history
 * step, matching every other multi-element mutation in this codebase.
 */
import { computeAlignChanges, computeDistributeChanges, groupSelection, lockSelection, unlockSelection, ungroupSelection } from "@deviva-draw/engine";
import type { AlignEdge, DistributeAxis } from "@deviva-draw/engine";
import type { Action, ActionRuntime } from "./action-types";

function selectedAlignableElements(runtime: ActionRuntime) {
  return [...runtime.selection.getSelectedIds()]
    .map((id) => runtime.scene.getElement(id))
    .filter((element): element is NonNullable<typeof element> => !!element && !element.isDeleted);
}

function alignAction(id: string, labelKey: Action["labelKey"], icon: string, edge: AlignEdge): Action {
  return {
    id,
    labelKey,
    icon,
    isEnabled: (runtime) => runtime.selection.size >= 2,
    run: (runtime) => {
      const changes = computeAlignChanges(selectedAlignableElements(runtime), edge);
      if (changes.length === 0) return;
      runtime.history.beginBatch();
      for (const change of changes) runtime.scene.updateElement(change.id, change.changes);
      runtime.history.endBatch(runtime.scene.getElements());
    },
  };
}

function distributeAction(id: string, labelKey: Action["labelKey"], icon: string, axis: DistributeAxis): Action {
  return {
    id,
    labelKey,
    icon,
    isEnabled: (runtime) => runtime.selection.size >= 3,
    run: (runtime) => {
      const changes = computeDistributeChanges(selectedAlignableElements(runtime), axis);
      if (changes.length === 0) return;
      runtime.history.beginBatch();
      for (const change of changes) runtime.scene.updateElement(change.id, change.changes);
      runtime.history.endBatch(runtime.scene.getElements());
    },
  };
}

export function buildArrangeActions(): Action[] {
  return [
    alignAction("align-left", "action.alignLeft", "align-left", "left"),
    alignAction("align-center-h", "action.alignCenterH", "align-center-h", "center-h"),
    alignAction("align-right", "action.alignRight", "align-right", "right"),
    alignAction("align-top", "action.alignTop", "align-top", "top"),
    alignAction("align-middle-v", "action.alignMiddleV", "align-middle-v", "middle-v"),
    alignAction("align-bottom", "action.alignBottom", "align-bottom", "bottom"),
    distributeAction("distribute-horizontal", "action.distributeHorizontal", "distribute-h", "horizontal"),
    distributeAction("distribute-vertical", "action.distributeVertical", "distribute-v", "vertical"),
    {
      id: "group",
      labelKey: "action.group",
      icon: "group",
      shortcut: "meta+g",
      isEnabled: (runtime) => runtime.selection.size >= 2,
      run: (runtime) => {
        const ids = [...runtime.selection.getSelectedIds()];
        runtime.history.beginBatch();
        groupSelection(runtime.scene, ids);
        runtime.history.endBatch(runtime.scene.getElements());
      },
    },
    {
      id: "ungroup",
      labelKey: "action.ungroup",
      icon: "ungroup",
      shortcut: "meta+shift+g",
      isEnabled: (runtime) => runtime.selection.size > 0,
      run: (runtime) => {
        const ids = [...runtime.selection.getSelectedIds()];
        runtime.history.beginBatch();
        ungroupSelection(runtime.scene, ids);
        runtime.history.endBatch(runtime.scene.getElements());
      },
    },
    {
      id: "toggle-lock",
      labelKey: "action.lock",
      icon: "lock",
      shortcut: "meta+shift+l",
      isEnabled: (runtime) => runtime.selection.size > 0,
      run: (runtime) => {
        const ids = [...runtime.selection.getSelectedIds()];
        const anyUnlocked = ids.some((id) => runtime.scene.getElement(id)?.locked === false);
        runtime.history.beginBatch();
        (anyUnlocked ? lockSelection : unlockSelection)(runtime.scene, ids);
        runtime.history.endBatch(runtime.scene.getElements());
      },
    },
  ];
}
