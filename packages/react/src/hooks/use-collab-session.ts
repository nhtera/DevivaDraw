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
import type { CollabConnectionStatus, CollabPagesAdapter, CollabRole, MintedRoom, PresenceViewport, RemotePeerPresence } from "@deviva-draw/collab-client";
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
  /** The link for this session in the local user's own role — the editor link when they started it, the link they joined with otherwise. */
  roomUrl: string | null;
  /** The read-only link for this session. Only the peer that started it holds one: a viewer cannot hand out rights they do not have, and an editor who joined by link was never given the viewer token. */
  viewerUrl: string | null;
  /** What the local user may do in this room. `editor` while disconnected. */
  role: CollabRole;
  peers: RemotePeerPresence[];
  error: CollabErrorReason;
  startSession(): Promise<void>;
  /**
   * Starts a session on a relay this machine is hosting (`lan-host-controller.ts`). Unlike
   * `startSession` it needs no configured `apiBaseUrl` — that is the entire point, since a hosted
   * room works with no internet at all — and the links it produces name the relay explicitly, because
   * a peer has no other way to learn an address that did not exist a minute ago.
   */
  hostSession(relayBaseUrl: string, room: MintedRoom): Promise<void>;
  joinSession(url: string): Promise<void>;
  leaveSession(): void;
  /** Publishes the local user's cursor position (scene coordinates); throttled internally by `CollabSession`. A no-op while no session is connected. */
  updateCursor(point: { x: number; y: number } | null): void;
  /** Sends a one-shot emoji reaction to every peer. Lossy by design and never retried — a no-op while no session is connected. */
  sendReaction(emoji: string): void;
  /** Raises or lowers the local user's hand for every peer. Sticky until changed or the session ends. */
  setHandRaised(raised: boolean): void;
  /** Publishes where this client is looking, so peers following it can match. See `use-follow-peer-camera.ts`. */
  setLocalViewport(viewport: PresenceViewport | null): void;
  /** Starts (or with `null` stops) following a peer's camera. */
  follow(peerId: string | null): void;
  /** The peer currently being followed, or `null`. Cleared automatically when that peer leaves. */
  followedPeerId: string | null;
  /** The followed peer's latest viewport — `null` when not following, or while they have not published one yet. */
  followedViewport: PresenceViewport | null;
  /** The local user's active page id in a multi-page host, `null` otherwise. Exposed so the peer list can tell which peers are on this page and therefore followable. */
  localPageId: string | null;
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
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [role, setRole] = useState<CollabRole>("editor");
  const [peers, setPeers] = useState<RemotePeerPresence[]>([]);
  const [error, setError] = useState<CollabErrorReason>(null);
  const [followedPeerId, setFollowedPeerId] = useState<string | null>(null);
  // Mirrors the page store's active page. Tracked as state, not read on demand, because following has
  // to react when EITHER side changes pages — a peer's move arrives via `peers`, the local user's does
  // not arrive at all unless something re-renders on it.
  const [localPageId, setLocalPageId] = useState<string | null>(null);

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
      setLocalPageId(pageStore.getActivePageId());
      let lastActive = pageStore.getActivePageId();
      unsubscribeActivePage = pageStore.subscribe(() => {
        const active = pageStore.getActivePageId();
        if (active === lastActive) return;
        lastActive = active;
        session.setLocalPage(active);
        setLocalPageId(active);
      });
    }

    return () => {
      unsubscribePresence();
      unsubscribeActivePage?.();
      session.disconnect();
      sessionRef.current = null;
      setStatus("disconnected");
      setRoomUrl(null);
      setViewerUrl(null);
      setRole("editor");
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
      const links = await session.startSession(apiBaseUrl, window.location.origin);
      setRoomUrl(links.editorUrl);
      setViewerUrl(links.viewerUrl);
      setRole(session.currentRole);
      setError(null);
    } catch (caught) {
      console.error("deviva-draw: collab startSession failed", caught);
      setError("start-failed");
    }
  }, [apiBaseUrl]);

  const hostSession = useCallback(async (relayBaseUrl: string, room: MintedRoom) => {
    const session = sessionRef.current;
    if (!session) {
      setError("not-configured");
      return;
    }
    try {
      // The relay is both the endpoint and the link's origin here: a self-hosted room has no separate
      // web app in front of it, so the address that serves the socket is the address on the link.
      const links = await session.startSession(relayBaseUrl, relayBaseUrl, { room, relayBaseUrl });
      setRoomUrl(links.editorUrl);
      setViewerUrl(links.viewerUrl);
      setRole(session.currentRole);
      setError(null);
    } catch (caught) {
      console.error("deviva-draw: collab hostSession failed", caught);
      setError("start-failed");
      throw caught;
    }
  }, []);

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
        // A joiner holds one link and one role — it cannot offer the other link, since only the peer
        // that started the session was ever handed the second token.
        setViewerUrl(null);
        setRole(session.currentRole);
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
    setViewerUrl(null);
    setRole("editor");
    setError(null);
  }, []);

  const updateCursor = useCallback((point: { x: number; y: number } | null) => {
    sessionRef.current?.updateCursor(point);
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    sessionRef.current?.sendReaction(emoji);
  }, []);

  const setHandRaised = useCallback((raised: boolean) => {
    sessionRef.current?.setHandRaised(raised);
  }, []);

  const setLocalViewport = useCallback((viewport: PresenceViewport | null) => {
    sessionRef.current?.setLocalViewport(viewport);
  }, []);

  // React state is what re-renders the dialog and the pill, so it holds the followed peer; the session
  // is told too, keeping `CollabSession.currentFollowedPeerId` honest for non-React consumers (the MCP
  // bridge) rather than leaving two sources of truth that disagree.
  const follow = useCallback((peerId: string | null) => {
    sessionRef.current?.follow(peerId);
    setFollowedPeerId(peerId);
  }, []);

  // Two ways a follow stops being followable, both ending the same way.
  //
  // The peer left: keeping it would leave the local view frozen on their last frame with a pill
  // claiming it is still tracking someone.
  //
  // The peer is now on a different page: their viewport describes a camera over *that* page's
  // content, and applying it here would swing this user's canvas to coordinates belonging to a page
  // they are not looking at — a jump to somewhere blank, with no visible cause. Clearing is right
  // rather than auto-switching pages: a page switch is a document navigation the user did not ask
  // for, and follow mode has no mandate to move them around the document.
  useEffect(() => {
    if (followedPeerId === null) return;
    if (canFollow(peers.find((peer) => peer.peerId === followedPeerId), localPageId)) return;
    sessionRef.current?.follow(null);
    setFollowedPeerId(null);
  }, [peers, followedPeerId, localPageId]);

  // Derived from `peers` rather than read through `CollabSession.getFollowedViewport()`: `peers` is the
  // value that actually re-renders on a presence update, so reading the session would hand the camera
  // hook a viewport one render stale.
  const followedViewport = followedPeerId === null ? null : (peers.find((peer) => peer.peerId === followedPeerId)?.viewport ?? null);

  return { status, roomUrl, viewerUrl, role, peers, error, startSession, hostSession, joinSession, leaveSession, updateCursor, sendReaction, setHandRaised, setLocalViewport, follow, followedPeerId, followedViewport, localPageId };
}

/**
 * Whether `peer` is something this client can coherently follow right now.
 *
 * Exported and pure so the one rule has a single home and a test: the dialog uses it to disable a
 * Follow button that would immediately undo itself, and the hook uses it to end a follow that has
 * stopped making sense.
 *
 * A peer with no `pageId` at all is followable. That is a peer running a single-scene or pre-pages
 * build, and it is the same "absent means everywhere" reading the shell already applies to their
 * cursor — treating unknown as mismatched would make older peers permanently unfollowable.
 */
export function canFollow(peer: RemotePeerPresence | undefined, localPageId: string | null): boolean {
  if (!peer) return false;
  if (peer.viewport === null) return false; // never published a viewport — nothing to follow
  if (peer.pageId === undefined || localPageId === null) return true;
  return peer.pageId === localPageId;
}
