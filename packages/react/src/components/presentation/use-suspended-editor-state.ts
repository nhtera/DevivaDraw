/**
 * Presentation borrows editor state, and gives it back.
 *
 * Two things the mode changes about the editor rather than about the presentation: the selection is
 * hidden, and the tool becomes the laser pointer. Both were one-way — presentation only hides
 * *chrome*, so nothing put either back, and the presenter returned to a board that had quietly
 * changed under them.
 *
 * The selection is the visible half. Its outline and resize handles were drawn over the slides, in
 * front of the audience, and the natural flow all but guarantees it: drawing a frame leaves that
 * frame selected, and the next thing a presenter does is press Present.
 *
 * Restoring rather than dropping, in both cases, because the change was ours and not the user's:
 * someone who presents mid-edit should find the board as they left it. Ids that stopped existing
 * meanwhile are filtered out — a collaborator can delete an element from under a presenter — so the
 * restore can never re-select a ghost.
 */
import { useEffect } from "react";
import { LASER_TOOL_NAME } from "../../runtime/tool-names";
import type { DevivaRuntime } from "../../runtime/runtime-types";

export function useSuspendedEditorState(runtime: DevivaRuntime): void {
  useEffect(() => {
    const selectedIds = [...runtime.selection.getSelectedIds()];
    const toolName = runtime.toolStateMachine.getActiveToolName();
    if (selectedIds.length > 0) runtime.selection.clear();
    // Selecting the laser belongs here, with the restore, and not in the entry effect that owns the
    // rest of entering. Split across the two, the pair stops being symmetric: a mount/cleanup/mount
    // cycle (which StrictMode does on every mount in development) restores the old tool and then
    // finds the entry effect's one-shot ref already spent, so the laser is never picked again and the
    // presentation runs on the select tool — where a double-click opens a text editor mid-talk.
    runtime.toolStateMachine.setTool(LASER_TOOL_NAME);

    return () => {
      runtime.toolStateMachine.setTool(toolName);
      const alive = selectedIds.filter((id) => {
        const element = runtime.scene.getElement(id);
        return !!element && !element.isDeleted;
      });
      if (alive.length > 0) runtime.selection.selectOnly(alive);
    };
  }, [runtime]);
}
