import { DevivaDraw } from "@deviva-draw/react";
import { createDesktopFileOperations } from "./desktop-file-operations";
import { SHARE_API_BASE_URL } from "./share-api-config";

// One provider for the app's lifetime — its watchers key off ids, not component identity.
const fileOperations = createDesktopFileOperations();

/**
 * Desktop shell — the editor and nothing else. Unlike the web app there are no `/s/` or `/room/`
 * routes: share links and collab invites are URLs that belong in a browser, and the shell's
 * navigation policy (see `src-tauri/src/main.rs`) sends any external URL to the system browser.
 * The in-editor Share/Collaborate dialogs still work when online, same as the web app.
 *
 * Persistence today is the same localStorage autosave the web app uses (WebView storage is
 * per-app and survives relaunches — verified in the Phase 1 spike). Real `.devivadraw` file
 * semantics arrive with the Phase 3 file-operations seam.
 */
export function App() {
  return <DevivaDraw shareApiBaseUrl={SHARE_API_BASE_URL} fileOperations={fileOperations} style={{ position: "fixed", inset: 0 }} />;
}
