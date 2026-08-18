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
 *
 * A room tab gets its own `persistenceKey`, which is what keeps opening someone's room from being a
 * destructive act. Without it the shell seeds the board from this browser's own autosave and the
 * room's document merges into it — you arrive carrying your own pages, see both boards stacked on
 * one canvas, and your saved work keeps the stranger's pages after you leave. Worse in the other
 * direction: an editor joining that way publishes their personal board into the room for everybody
 * else. Scoping the key means a room opens on the room's own document (nothing is stored under that
 * key the first time), your own board is neither read nor written while you are in there, and a
 * refresh still restores the room you were in.
 *
 * Bringing your own work into a session is the other flow, unchanged: start a session from your
 * board and share the link it gives you.
 */
/** Prefix for a room tab's own autosave slot, kept distinct from the default board's key. */
const ROOM_STORAGE_PREFIX = "deviva-draw-room:";

const ROOM_PATH_PATTERN = /^\/room\/([^/]+)\/?$/;

/** The room id in `pathname`, or `null` when this is not a room URL. */
function matchRoomId(pathname: string): string | null {
  const match = ROOM_PATH_PATTERN.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function App() {
  useEffect(() => {
    document.title = "Deviva Draw";
  }, []);

  if (window.location.pathname.startsWith("/s/")) return <SharedSceneViewerRoute />;

  const roomId = matchRoomId(window.location.pathname);
  return (
    <DevivaDraw
      shareApiBaseUrl={SHARE_API_BASE_URL}
      initialRoomUrl={roomId === null ? undefined : window.location.href}
      persistenceKey={roomId === null ? undefined : `${ROOM_STORAGE_PREFIX}${roomId}`}
      style={{ position: "fixed", inset: 0 }}
    />
  );
}
