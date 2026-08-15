/**
 * "Share" action: encrypts the live scene client-side and uploads only ciphertext to the collab-server
 * (see `browser/share-link-client.ts` and `@deviva-draw/engine`'s `share-link/` module for the actual
 * crypto). This file is just the `ActionRegistry` wiring + `ShareDialogState` bookkeeping every other
 * main-menu-triggered dialog already follows (see `action-types.ts`'s `UiToggleState`) — the dialog
 * itself (`components/share-dialog.tsx`) only ever reads state written here, never calls
 * `persistence.shareScene()` directly.
 */
import type { Action, ActionRuntime } from "./action-types";
import { appendShareLinkHistory } from "../browser/share-link-history";

/**
 * The whole share flow, callable outside the registry too: the dialog's "generate a new link with
 * an expiry" control re-runs this with an `expiresAt` (the plain action always creates the default
 * never-expiring link) — one implementation, two entry points, no drifting duplicate.
 */
export async function runShareScene(runtime: ActionRuntime, expiresAt?: string): Promise<void> {
  runtime.ui.setShareDialogState({ status: "generating" });
  try {
    const result = await runtime.persistence.shareScene(expiresAt !== undefined ? { expiresAt } : undefined);
    // Record the revocation credentials before showing the link: the token exists only on this
    // client, and losing the record means the link can never be revoked. `localStorage` guarded for
    // non-browser hosts (unit tests) — history is then simply not kept.
    if (typeof window !== "undefined") {
      appendShareLinkHistory(window.localStorage, {
        blobId: result.blobId,
        deleteToken: result.deleteToken,
        createdAt: Date.now(),
        pageCount: result.pageCount,
        ...(result.expiresAt !== undefined ? { expiresAt: result.expiresAt } : {}),
      });
    }
    runtime.ui.setShareDialogState({ status: "ready", url: result.url });
  } catch (error) {
    console.error("deviva-draw: share-scene action failed", error);
    runtime.ui.setShareDialogState({ status: "error" });
  }
}

export function buildShareActions(): Action[] {
  return [
    {
      id: "share-scene",
      labelKey: "action.share",
      icon: "share",
      viewOnlyAllowed: true,
      // Opens the dialog idle — generation happens on the dialog's explicit "Create link" (which
      // calls `runShareScene` above). See `ShareDialogState`'s doc for why opening must not mint.
      run: (runtime) => runtime.ui.setShareDialogState({ status: "idle" }),
    },
  ];
}
