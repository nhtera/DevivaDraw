/**
 * "Share" action: encrypts the live scene client-side and uploads only ciphertext to the collab-server
 * (see `browser/share-link-client.ts` and `@deviva-draw/engine`'s `share-link/` module for the actual
 * crypto). This file is just the `ActionRegistry` wiring + `ShareDialogState` bookkeeping every other
 * main-menu-triggered dialog already follows (see `action-types.ts`'s `UiToggleState`) — the dialog
 * itself (`components/share-dialog.tsx`) only ever reads state written here, never calls
 * `persistence.shareScene()` directly.
 */
import type { Action } from "./action-types";

export function buildShareActions(): Action[] {
  return [
    {
      id: "share-scene",
      labelKey: "action.share",
      icon: "share",
      run: async (runtime) => {
        runtime.ui.setShareDialogState({ status: "generating" });
        try {
          const url = await runtime.persistence.shareScene();
          runtime.ui.setShareDialogState({ status: "ready", url });
        } catch (error) {
          console.error("deviva-draw: share-scene action failed", error);
          runtime.ui.setShareDialogState({ status: "error" });
        }
      },
    },
  ];
}
