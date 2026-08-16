/**
 * `useCollabSession` — thin React wiring exposing `@deviva-draw/collab-client`'s `CollabSession` to the
 * chrome layer. Collaboration is opt-in at this hook's boundary: called with `scene: null` (no runtime
 * mounted yet, e.g. before `useDevivaRuntime` finishes its mount effect) it constructs nothing and
 * touches no network; a host that never renders UI driven by this hook's return value (no collab
 * button, no dialog) never triggers a connection, matching the requirement that the lib package must
 * not force collab on an embedding app.
 *
 * Not unit tested for the same reason every other hook in this package documents (no
 * `@testing-library/react` dependency — see `runtime/use-live-version.ts`'s module doc): the
 * `CollabSession` this hook wraps is already thoroughly unit tested in `@deviva-draw/collab-client`,
 * including two-simulated-clients convergence over an in-memory relay; this file has no decision logic
 * left to test beyond React lifecycle wiring (construct-on-scene-ready, subscribe-to-presence,
 * dispose-on-unmount).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CollabSession, createPageStoreCollabAdapter } from "@deviva-draw/collab-client";
import type { CollabConnectionStatus, CollabPagesAdapter, RemotePeerPresence } from "@deviva-draw/collab-client";
import type { Scene } from "@deviva-draw/engine";
import { randomGuestColor, randomGuestName } from "./random-collab-identity";
import type { PageStore } from "../pages/page-store";

export interface UseCollabSessionOptions {
  scene: Scene | null;
  /**
   * Multi-page host: the session anchors to this stable store instead of the (per-page) `scene`, so a
   * page switch never tears a live session down; element sync spans every page and the page list
   * itself syncs (see `@deviva-draw/collab-client`'s `pages-adapter.ts`). The local user's active
   * page also rides with presence, keeping their cursor off other pages' canvases.
   */
  pageStore?: PageStore | null;
  /** The collab-server's base URL — omitted makes `startSession`/`joinSession` reject immediately rather than attempting a request to nowhere, mirroring `PersistenceOperations.shareScene`'s `shareApiBaseUrl` contract. */
  apiBaseUrl?: string;
}

/** Machine-checkable failure reason (mirrors `DecryptSceneErrorReason`'s "code, not prose" contract) so the dialog component picks an i18n'd message rather than displaying free text. `null` means no error is currently active. */
export type CollabErrorReason = "not-configured" | "start-failed" | "join-failed" | null;

export interface UseCollabSessionResult {
  status: CollabConnectionStatus;
  roomUrl: string | null;
  peers: RemotePeerPresence[];
  error: CollabErrorReason;
  startSession(): Promise<void>;
  joinSession(url: string): Promise<void>;
  leaveSession(): void;
  /** Publishes the local user's cursor position (scene coordinates); throttled internally by `CollabSession`. A no-op while no session is connected. */
  updateCursor(point: { x: number; y: number } | null): void;
}

export function useCollabSession(options: UseCollabSessionOptions): UseCollabSessionResult {
  const { scene, pageStore, apiBaseUrl } = options;
  const sessionRef = useRef<CollabSession | null>(null);
  // The session lives as long as its anchor: the stable page store when present (a page switch swaps
  // `scene` but must not drop a live session), the scene itself otherwise.
  const sessionAnchor = pageStore ?? scene;
  const identityRef = useRef<{ name: string; color: string } | null>(null);
  identityRef.current ??= { name: randomGuestName(), color: randomGuestColor() };

  const [status, setStatus] = useState<CollabConnectionStatus>("disconnected");
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [peers, setPeers] = useState<RemotePeerPresence[]>([]);
  const [error, setError] = useState<CollabErrorReason>(null);

  useEffect(() => {
    if (!sessionAnchor) return;
    const identity = identityRef.current!;
    // The canonical PageStore↔collab wiring lives beside `PageStore` in `@deviva-draw/collab-client`
    // (`page-store-adapter.ts`) — shared verbatim with the headless MCP live-session bridge.
    const pages: CollabPagesAdapter | undefined = pageStore ? createPageStoreCollabAdapter(pageStore) : undefined;
    const session = new CollabSession({
      scene: pageStore ? pageStore.getActiveScene() : scene!,
      pages,
      userName: identity.name,
      userColor: identity.color,
      onStatusChange: setStatus,
    });
    sessionRef.current = session;
    const unsubscribePresence = session.presence.subscribe(() => setPeers(session.presence.list()));

    // The local user's page rides with presence — set now and on every active-page change.
    let unsubscribeActivePage: (() => void) | null = null;
    if (pageStore) {
      session.setLocalPage(pageStore.getActivePageId());
      let lastActive = pageStore.getActivePageId();
      unsubscribeActivePage = pageStore.subscribe(() => {
        const active = pageStore.getActivePageId();
        if (active === lastActive) return;
        lastActive = active;
        session.setLocalPage(active);
      });
    }

    return () => {
      unsubscribePresence();
      unsubscribeActivePage?.();
      session.disconnect();
      sessionRef.current = null;
      setStatus("disconnected");
      setRoomUrl(null);
      setPeers([]);
    };
    // Keyed on the anchor ALONE, deliberately: with a page store, `scene` changes on every page
    // switch and must not re-create (i.e. disconnect) the session; without one, the anchor IS the
    // scene, so the dependency is still honest.
  }, [sessionAnchor]);

  const startSession = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || !apiBaseUrl) {
      setError("not-configured");
      return;
    }
    try {
      const url = await session.startSession(apiBaseUrl, window.location.origin);
      setRoomUrl(url);
      setError(null);
    } catch (caught) {
      console.error("deviva-draw: collab startSession failed", caught);
      setError("start-failed");
    }
  }, [apiBaseUrl]);

  const joinSession = useCallback(
    async (url: string) => {
      const session = sessionRef.current;
      if (!session || !apiBaseUrl) {
        setError("not-configured");
        return;
      }
      try {
        await session.joinSession(apiBaseUrl, url);
        setRoomUrl(url);
        setError(null);
      } catch (caught) {
        console.error("deviva-draw: collab joinSession failed", caught);
        setError("join-failed");
      }
    },
    [apiBaseUrl],
  );

  const leaveSession = useCallback(() => {
    sessionRef.current?.disconnect();
    setRoomUrl(null);
    setError(null);
  }, []);

  const updateCursor = useCallback((point: { x: number; y: number } | null) => {
    sessionRef.current?.updateCursor(point);
  }, []);

  return { status, roomUrl, peers, error, startSession, joinSession, leaveSession, updateCursor };
}
