/**
 * Library actions reachable without the sidebar. Saving a selection used to require opening the
 * library panel first and finding its add tile — the shape you want to keep is on the canvas, under
 * the cursor, which is where the offer belongs.
 *
 * The save itself lives in `browser/save-selection-to-library.ts` and is shared with that tile, so both
 * entry points name, preview and shelve an item identically.
 */
import { saveSelectionToLibrary } from "../browser/save-selection-to-library";
import type { Action } from "./action-types";

export function buildLibraryActions(): Action[] {
  return [
    {
      id: "add-to-library",
      labelKey: "action.addToLibrary",
      icon: "library",
      isEnabled: (runtime) => runtime.selection.size > 0,
      run: async (runtime) => {
        await saveSelectionToLibrary(runtime.scene, [...runtime.selection.getSelectedIds()]);
      },
    },
  ];
}
