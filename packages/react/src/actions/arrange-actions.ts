/**
 * Align/distribute/flip/group/ungroup/lock actions — align/distribute/flip compute pure `{id, changes}` pairs
 * via `@deviva-draw/engine`'s `selection/align-distribute.ts` and apply them as one batched history
 * step, matching every other multi-element mutation in this codebase.
 */
import { computeAlignChanges, computeDistributeChanges, computeFlipChanges, groupSelection, lockSelection, unlockSelection, ungroupSelection } from "@deviva-draw/engine";
import type { AlignEdge, DistributeAxis, FlipAxis } from "@deviva-draw/engine";
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

/**
 * Flipping needs one element, not two: a lone shape mirrors within its own box (a block arrow turns
 * around, a triangle lands point-down), which is the common case — align/distribute are the ones that
 * are meaningless below two.
 */
function flipAction(id: string, labelKey: Action["labelKey"], icon: string, shortcut: string, axis: FlipAxis): Action {
  return {
    id,
    labelKey,
    icon,
    shortcut,
    isEnabled: (runtime) => runtime.selection.size >= 1,
    run: (runtime) => {
      const changes = computeFlipChanges(selectedAlignableElements(runtime), axis);
      if (changes.length === 0) return;
      runtime.history.beginBatch();
      for (const change of changes) runtime.scene.updateElement(change.id, change.changes);
      runtime.history.endBatch(runtime.scene.getElements());
    },
  };
}

export function buildArrangeActions(): Action[] {
  return [
    flipAction("flip-horizontal", "action.flipHorizontal", "flip-h", "shift+h", "horizontal"),
    flipAction("flip-vertical", "action.flipVertical", "flip-v", "shift+v", "vertical"),
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
      // Enabled only when something in the selection actually belongs to a group. Gating on "anything
      // is selected" left Ungroup offered (and a no-op) on a single ungrouped element, right next to a
      // correctly-disabled Group — which reads as the menu being broken.
      isEnabled: (runtime) =>
        [...runtime.selection.getSelectedIds()].some((id) => {
          const element = runtime.scene.getElement(id);
          return Boolean(element && !element.isDeleted && element.groupIds.length > 0);
        }),
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
    {
      // Locked elements ignore clicks by design, so they can't be selected and unlocked one by one —
      // this canvas-level escape hatch frees every locked element at once and selects them, making
      // the result visible (and immediately re-lockable if the release was a mistake).
      id: "unlock-all",
      labelKey: "action.unlockAll",
      icon: "lock",
      isEnabled: (runtime) => runtime.scene.getElements().some((element) => !element.isDeleted && element.locked),
      run: (runtime) => {
        const ids = runtime.scene
          .getElements()
          .filter((element) => !element.isDeleted && element.locked)
          .map((element) => element.id);
        runtime.history.beginBatch();
        unlockSelection(runtime.scene, ids);
        runtime.history.endBatch(runtime.scene.getElements());
        runtime.selection.selectOnly(ids);
      },
    },
  ];
}
