import { useEffect } from "react";
import { DevivaDraw } from "@deviva-draw/react";
import { SharedSceneViewerRoute } from "./routes/shared-scene-viewer";
import { SHARE_API_BASE_URL } from "./share-api-config";

/**
 * Application shell for the standalone Deviva Draw app (draw.deviva.app) — a thin wrapper around the
 * composed `<DevivaDraw/>` component from `@deviva-draw/react`, full-screen, with no props overridden
 * beyond `shareApiBaseUrl` (theme/locale default to the persisted preference or the browser/system
 * default; scene data defaults to localStorage autosave restore/save, this app's whole persistence
 * story). Every actual feature (canvas, tools, toolbar, panels, menus, shortcuts, mobile/touch,
 * theming, i18n) lives in `@deviva-draw/react` — this app is just the browser tab that hosts it.
 *
 * Routing is a single `pathname` check, not a router dependency (YAGNI: this app has exactly two
 * "pages" — the editor and the read-only shared-scene viewer — a full router is unwarranted for that).
 * `/s/{blobId}` share links render `<SharedSceneViewerRoute/>` instead of the editable shell; every
 * other path renders the normal editor.
 */
export function App() {
  useEffect(() => {
    document.title = "Deviva Draw";
  }, []);

  if (window.location.pathname.startsWith("/s/")) return <SharedSceneViewerRoute />;
  return <DevivaDraw shareApiBaseUrl={SHARE_API_BASE_URL} style={{ position: "fixed", inset: 0 }} />;
}
