/**
 * "Share" action: encrypts the live scene client-side and uploads only ciphertext to the collab-server
 * (see `browser/share-link-client.ts` and `@deviva-draw/engine`'s `share-link/` module for the actual
 * crypto). This file is just the `ActionRegistry` wiring + `ShareDialogState` bookkeeping every other
 * main-menu-triggered dialog already follows (see `action-types.ts`'s `UiToggleState`) — the dialog
 * itself (`components/share-dialog.tsx`) only ever reads state written here, never calls
 * `persistence.shareScene()` directly.
 */
import type { Action } from "./action-types";
import { appendShareLinkHistory } from "../browser/share-link-history";

export function buildShareActions(): Action[] {
  return [
    {
      id: "share-scene",
      labelKey: "action.share",
      icon: "share",
      viewOnlyAllowed: true,
      run: async (runtime) => {
        runtime.ui.setShareDialogState({ status: "generating" });
        try {
          const result = await runtime.persistence.shareScene();
          // Record the revocation credentials before showing the link: the token exists only on
          // this client, and losing the record means the link can never be revoked. `localStorage`
          // guarded for non-browser hosts (unit tests) — history is then simply not kept.
          if (typeof window !== "undefined") {
            appendShareLinkHistory(window.localStorage, { blobId: result.blobId, deleteToken: result.deleteToken, createdAt: Date.now(), pageCount: result.pageCount });
          }
          runtime.ui.setShareDialogState({ status: "ready", url: result.url });
        } catch (error) {
          console.error("deviva-draw: share-scene action failed", error);
          runtime.ui.setShareDialogState({ status: "error" });
        }
      },
    },
  ];
}
