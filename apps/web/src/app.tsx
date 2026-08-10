import { useEffect } from "react";
import { DevivaDraw } from "@deviva-draw/react";
import { SharedSceneViewerRoute } from "./routes/shared-scene-viewer";
import { SHARE_API_BASE_URL } from "./share-api-config";

/**
 * Application shell for the standalone Deviva Draw app (draw.deviva.app) — a thin wrapper around the
 * composed `<DevivaDraw/>` component from `@deviva-draw/react`, full-screen, with no props overridden
 * beyond `shareApiBaseUrl` (theme defaults to the persisted preference then light, locale to the
 * persisted preference then the browser language; scene data defaults to localStorage autosave restore/save, this app's whole persistence
 * story). Every actual feature (canvas, tools, toolbar, panels, menus, shortcuts, mobile/touch,
 * theming, i18n) lives in `@deviva-draw/react` — this app is just the browser tab that hosts it.
 *
 * Routing is a single `pathname` check, not a router dependency (YAGNI: this app has a small, fixed
 * set of "pages"). `/s/{blobId}` share links render the read-only `<SharedSceneViewerRoute/>`;
 * `/room/{id}#key=...` collaboration links render the editable shell and auto-join that live session
 * (the full room URL, fragment key included, is read straight from `window.location`); every other
 * path renders the normal editor.
 */
export function App() {
  useEffect(() => {
    document.title = "Deviva Draw";
  }, []);

  if (window.location.pathname.startsWith("/s/")) return <SharedSceneViewerRoute />;

  const isRoom = window.location.pathname.startsWith("/room/");
  const initialRoomUrl = isRoom ? window.location.href : undefined;
  return (
    <DevivaDraw
      shareApiBaseUrl={SHARE_API_BASE_URL}
      initialRoomUrl={initialRoomUrl}
      style={{ position: "fixed", inset: 0 }}
    />
  );
}
