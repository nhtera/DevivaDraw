/**
 * Room URL scheme: `{origin}/room/{roomId}#key={base64Key}` — the same fragment-key trust boundary
 * `@deviva-draw/engine`'s `share-link/build-share-url.ts` uses for static share links, extended to a
 * live room: the key lives only in the URL fragment, which browsers never send to any server, so
 * `apps/collab-server` never has a way to obtain it. `buildRoomWebSocketUrl` is the separate,
 * server-facing half — it derives the collab-server's WebSocket endpoint from its own HTTP(S) base URL
 * and never touches the key at all.
 */
export interface BuildRoomUrlOptions {
  origin: string;
  roomId: string;
  keyBase64Url: string;
}

export function buildRoomUrl(options: BuildRoomUrlOptions): string {
  const { origin, roomId, keyBase64Url } = options;
  const normalizedOrigin = origin.replace(/\/+$/, "");
  return `${normalizedOrigin}/room/${encodeURIComponent(roomId)}#key=${keyBase64Url}`;
}

export type ParseRoomUrlErrorReason = "invalid-path" | "missing-room-id" | "missing-key";

export interface ParsedRoomUrl {
  roomId: string;
  keyBase64Url: string;
}

export type ParseRoomUrlResult = { ok: true; value: ParsedRoomUrl } | { ok: false; reason: ParseRoomUrlErrorReason; error: string };

const ROOM_PATH_PATTERN = /^\/room\/([^/]+)\/?$/;

/** Inverse of `buildRoomUrl` — accepts pathname/fragment as plain strings (mirroring `parse-share-url.ts`) so a caller already holding `window.location` fields doesn't need to reconstruct a URL object. Never throws: a room link can be attacker-crafted or corrupted in transit. */
export function parseRoomUrl(pathname: string, fragment: string): ParseRoomUrlResult {
  const pathMatch = ROOM_PATH_PATTERN.exec(pathname);
  if (!pathMatch) return { ok: false, reason: "invalid-path", error: 'room URL path must be "/room/{roomId}"' };

  const rawRoomId = pathMatch[1];
  if (!rawRoomId) return { ok: false, reason: "missing-room-id", error: "room URL is missing a room id" };
  const roomId = decodeURIComponent(rawRoomId);

  const normalizedFragment = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const keyBase64Url = new URLSearchParams(normalizedFragment).get("key");
  if (!keyBase64Url) return { ok: false, reason: "missing-key", error: "room URL fragment is missing the decryption key" };

  return { ok: true, value: { roomId, keyBase64Url } };
}

/** Derives the collab-server's WebSocket room endpoint from its HTTP(S) base URL — `http(s)://host` -> `ws(s)://host/room/{roomId}`. */
export function buildRoomWebSocketUrl(apiBaseUrl: string, roomId: string): string {
  const normalized = apiBaseUrl.replace(/\/+$/, "");
  const wsBase = normalized.replace(/^http/, "ws");
  return `${wsBase}/room/${encodeURIComponent(roomId)}`;
}
