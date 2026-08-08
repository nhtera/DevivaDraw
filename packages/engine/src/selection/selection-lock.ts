/**
 * Lock/unlock a selection: writes `BaseElement.locked` (already part of the base element model) via
 * `Scene.updateElement`. A locked element is otherwise still a normal element — it still renders,
 * still participates in every cascade (delete-with-container, bound-arrow reroute, ...) — the *only*
 * behavioral difference is that `hit-test.ts`/`marquee-select.ts` both skip it, so pointer selection
 * (click or rubber-band) can never pick it up again until it's unlocked. That skip is where "locked"
 * actually takes effect; this module is just the two small mutations that flip the flag.
 */
import type { Scene } from "../scene/scene";

function setLocked(scene: Scene, ids: readonly string[], locked: boolean): void {
  for (const id of ids) {
    const element = scene.getElement(id);
    if (element && !element.isDeleted && element.locked !== locked) scene.updateElement(id, { locked });
  }
}

export function lockSelection(scene: Scene, ids: readonly string[]): void {
  setLocked(scene, ids, true);
}

export function unlockSelection(scene: Scene, ids: readonly string[]): void {
  setLocked(scene, ids, false);
}
