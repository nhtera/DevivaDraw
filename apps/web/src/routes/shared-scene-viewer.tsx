import { SharedSceneViewer } from "@deviva-draw/react";
import { SHARE_API_BASE_URL } from "../share-api-config";

/**
 * Thin wrapper around `@deviva-draw/react`'s `<SharedSceneViewer/>` for the `/s/{blobId}` route — this
 * app supplies only the collab-server base URL; every other concern (parsing the share fragment,
 * fetching + decrypting ciphertext, i18n'd loading/error states, rendering the read-only app shell)
 * lives in `@deviva-draw/react` alongside the rest of the UI chrome/i18n it already owns (see the
 * repo's `README.md`: this app is "just the browser tab that hosts it").
 */
export function SharedSceneViewerRoute() {
  return <SharedSceneViewer apiBaseUrl={SHARE_API_BASE_URL} style={{ position: "fixed", inset: 0 }} />;
}
