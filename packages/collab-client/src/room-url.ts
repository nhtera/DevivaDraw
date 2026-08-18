/**
 * Room URL scheme: `{origin}/room/{roomId}#key={base64Key}` — the same fragment-key trust boundary
 * `@deviva-draw/engine`'s `share-link/build-share-url.ts` uses for static share links, extended to a
 * live room: the key lives only in the URL fragment, which browsers never send to any server, so
 * `apps/collab-server` never has a way to obtain it. `buildRoomWebSocketUrl` is the separate,
 * server-facing half — it derives the collab-server's WebSocket endpoint from its own HTTP(S) base URL
 * and never touches the key at all.
 *
 * A room URL may also carry a role token (`?t=…`), which decides whether the connection may write —
 * see `apps/collab-server`'s `room-role-token.ts`. It sits in the query, not the fragment, precisely
 * because the fragment is the half a server never sees: the key must stay hidden from the relay, and
 * the token must reach it. The two halves of a room link therefore have opposite requirements, which is
 * why they live on opposite sides of the `#`.
 *
 * A link to a room hosted on somebody's own machine carries one more thing: `?relay=…`, the base URL of
 * the relay itself. A link to the hosted relay needs no such field, because every client already has
 * that address compiled in — but a room hosted on a laptop lives at an address nobody could know in
 * advance, and a peer that cannot learn it from the link cannot join at all. It is a separate field
 * rather than an inference from the link's own origin so that "which relay does this connect to" is
 * something a person can read off the URL instead of a rule they have to know.
 */
/** Query parameter carrying the role token. Must match `apps/collab-server`'s `ROLE_TOKEN_PARAM` — the two packages do not share code, so they share this name by convention and by the integration test that drives both. */
export const ROLE_TOKEN_PARAM = "t";

/** Query parameter naming the relay a self-hosted room lives on. Absent on links to the configured relay. */
export const RELAY_PARAM = "relay";

export interface BuildRoomUrlOptions {
  origin: string;
  roomId: string;
  keyBase64Url: string;
  /** Role token proving what this link may do on the relay. Omitted produces a pre-roles link, which the relay treats as an editor. */
  token?: string;
  /** Base URL of a self-hosted relay (the desktop app's LAN host). Omit for the configured relay, whose address every client already holds. */
  relayBaseUrl?: string;
}

export function buildRoomUrl(options: BuildRoomUrlOptions): string {
  const { origin, roomId, keyBase64Url, token, relayBaseUrl } = options;
  const normalizedOrigin = origin.replace(/\/+$/, "");
  const parameters = new URLSearchParams();
  if (token) parameters.set(ROLE_TOKEN_PARAM, token);
  if (relayBaseUrl) parameters.set(RELAY_PARAM, relayBaseUrl.replace(/\/+$/, ""));
  const query = parameters.size > 0 ? `?${parameters.toString()}` : "";
  return `${normalizedOrigin}/room/${encodeURIComponent(roomId)}${query}#key=${keyBase64Url}`;
}

export type ParseRoomUrlErrorReason = "invalid-path" | "missing-room-id" | "missing-key";

export interface ParsedRoomUrl {
  roomId: string;
  keyBase64Url: string;
  /** The link's role token, or `null` for a link that carries none (which joins as an editor). */
  token: string | null;
  /** A self-hosted relay's base URL, or `null` to use the client's configured one. Only ever a local-network address — see `readRelayBaseUrl`. */
  relayBaseUrl: string | null;
}

export type ParseRoomUrlResult = { ok: true; value: ParsedRoomUrl } | { ok: false; reason: ParseRoomUrlErrorReason; error: string };

const ROOM_PATH_PATTERN = /^\/room\/([^/]+)\/?$/;

/** Inverse of `buildRoomUrl` — accepts pathname/fragment/search as plain strings (mirroring `parse-share-url.ts`) so a caller already holding `window.location` fields doesn't need to reconstruct a URL object. `search` defaults to empty, which parses a pre-roles link as tokenless. Never throws: a room link can be attacker-crafted or corrupted in transit. */
export function parseRoomUrl(pathname: string, fragment: string, search = ""): ParseRoomUrlResult {
  const pathMatch = ROOM_PATH_PATTERN.exec(pathname);
  if (!pathMatch) return { ok: false, reason: "invalid-path", error: 'room URL path must be "/room/{roomId}"' };

  const rawRoomId = pathMatch[1];
  if (!rawRoomId) return { ok: false, reason: "missing-room-id", error: "room URL is missing a room id" };
  const roomId = decodeURIComponent(rawRoomId);

  const normalizedFragment = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const keyBase64Url = new URLSearchParams(normalizedFragment).get("key");
  if (!keyBase64Url) return { ok: false, reason: "missing-key", error: "room URL fragment is missing the decryption key" };

  const parameters = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const token = parameters.get(ROLE_TOKEN_PARAM);
  return { ok: true, value: { roomId, keyBase64Url, token, relayBaseUrl: readRelayBaseUrl(parameters.get(RELAY_PARAM)) } };
}

/**
 * The relay base URL a link may point at — but only if it names a machine on a local network.
 *
 * A room link is something people paste from a chat message, so `relay` is an instruction from an
 * untrusted source telling this client where to open a socket. The relay only ever sees ciphertext, so
 * a hostile value cannot read a board; it could still turn a pasted link into a connection to an
 * arbitrary host, which is not something a whiteboard should offer. Restricting it to loopback and the
 * private IPv4 ranges keeps the field doing exactly the one job it exists for — reaching a relay on
 * the network you are already on — and nothing else. Anything else reads as absent, so the client
 * falls back to its configured relay rather than failing on a link that is merely odd.
 */
export function readRelayBaseUrl(value: string | null): string | null {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return isLocalNetworkHost(parsed.hostname) ? parsed.origin : null;
}

/** Loopback, or one of the private IPv4 ranges (including link-local, which is what two machines joined by a single cable end up with). */
function isLocalNetworkHost(hostname: string): boolean {
  // `URL` always renders an IPv6 literal bracketed, so only the bracketed form can ever appear here.
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!octets) return false;
  const [first, second] = [Number(octets[1]), Number(octets[2])];
  if (octets.slice(1).some((octet) => Number(octet) > 255)) return false;
  if (first === 127 || first === 10) return true;
  if (first === 192 && second === 168) return true;
  if (first === 169 && second === 254) return true;
  return first === 172 && second >= 16 && second <= 31;
}

/** Derives the collab-server's WebSocket room endpoint from its HTTP(S) base URL — `http(s)://host` -> `ws(s)://host/room/{roomId}`, carrying the role token when the link had one. */
export function buildRoomWebSocketUrl(apiBaseUrl: string, roomId: string, token?: string | null): string {
  const normalized = apiBaseUrl.replace(/\/+$/, "");
  const wsBase = normalized.replace(/^http/, "ws");
  const query = token ? `?${ROLE_TOKEN_PARAM}=${encodeURIComponent(token)}` : "";
  return `${wsBase}/room/${encodeURIComponent(roomId)}${query}`;
}

/**
 * What a link claims it may do, read from the token's role prefix (`{role}.{mac}` — see
 * `apps/collab-server`'s `room-role-token.ts`).
 *
 * A *claim*, deliberately: this client cannot verify the MAC, and is not supposed to. The relay
 * verifies the same token and enforces the answer, so the worst a tampered prefix achieves is a client
 * that shows itself the wrong chrome while every write it attempts is dropped. Reading it locally is
 * what lets a viewer's UI say "read-only" instead of silently swallowing their edits.
 *
 * Anything unrecognised — no token, an unknown prefix, a bare MAC — reads as `editor`, which is what
 * every room link created before roles existed is.
 */
export function roleClaimedByToken(token: string | null | undefined): "editor" | "viewer" {
  return token?.startsWith("viewer.") ? "viewer" : "editor";
}

