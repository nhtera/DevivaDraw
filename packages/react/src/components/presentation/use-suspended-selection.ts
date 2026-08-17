/**
 * Presentation hides the selection, and puts it back on the way out.
 *
 * Selection is editor state, and presentation only hides *chrome* — so the interactive layer went on
 * drawing the outline and resize handles of whatever was selected, over the first slide, in front of
 * the audience. The natural flow all but guarantees it: drawing a frame leaves that frame selected,
 * and the next thing a presenter does is press Present.
 *
 * Restored on exit rather than dropped, because clearing it was our doing and not the user's: someone
 * who presents mid-edit should find the board as they left it. Ids that stopped existing while
 * presenting are filtered out — a collaborator can delete an element from under a presenter — so the
 * restore can never re-select a ghost.
 */
import { useEffect } from "react";
import type { DevivaRuntime } from "../../runtime/runtime-types";

export function useSuspendedSelection(runtime: DevivaRuntime): void {
  useEffect(() => {
    const suspended = [...runtime.selection.getSelectedIds()];
    if (suspended.length > 0) runtime.selection.clear();
    return () => {
      const alive = suspended.filter((id) => {
        const element = runtime.scene.getElement(id);
        return !!element && !element.isDeleted;
      });
      if (alive.length > 0) runtime.selection.selectOnly(alive);
    };
  }, [runtime]);
}
