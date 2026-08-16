import { useEffect, useRef } from "react";
import { DevivaDraw } from "@deviva-draw/react";
import type { DevivaDrawHandle } from "@deviva-draw/react";
import { createDesktopFileOperations } from "./desktop-file-operations";
import { DocumentHost } from "./document-host";
import { SHARE_API_BASE_URL } from "./share-api-config";

// One provider + one host for the app's lifetime — watchers/menu/recents key off ids and OS
// state, not React component identity, and `onDocumentStateChange` must be referentially stable.
const fileOperations = createDesktopFileOperations();
const documentHost = new DocumentHost(fileOperations);

/**
 * Desktop shell — the editor and nothing else. Unlike the web app there are no `/s/` or `/room/`
 * routes: share links and collab invites are URLs that belong in a browser, and the shell's
 * navigation policy (see `src-tauri/src/main.rs`) sends any external URL to the system browser.
 * The in-editor Share/Collaborate dialogs still work when online, same as the web app.
 *
 * `DocumentHost` owns everything document-shaped around the editor: window title + dirty dot,
 * the native menu (dispatching through the editor's own action registry), recents, external
 * opens (file association / drag-drop / second instance), and the unsaved-close guard.
 */
export function App() {
  const editorRef = useRef<DevivaDrawHandle>(null);

  useEffect(() => {
    documentHost.bindHandle(() => editorRef.current);
    void documentHost.start();
  }, []);

  return (
    <DevivaDraw
      ref={editorRef}
      shareApiBaseUrl={SHARE_API_BASE_URL}
      fileOperations={fileOperations}
      onDocumentStateChange={documentHost.onDocumentStateChange}
      offlineHints
      style={{ position: "fixed", inset: 0 }}
    />
  );
}
