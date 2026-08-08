/**
 * Thin routing layer between `index.ts`'s Worker `fetch` handler and a room's `RoomDO` instance —
 * resolves `/room/{roomId}` to the one Durable Object addressed by that room id (`idFromName` derives a
 * stable id from the string, so the same `roomId` always reaches the same DO instance) and forwards the
 * WebSocket-upgrade request to it. Every actual connection/relay decision lives in `RoomDO`/
 * `room-connection-registry.ts`; this file only knows how to find the right instance.
 */
export interface RoomNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Response | Promise<Response> };
}

const ROOM_PATH_PATTERN = /^\/room\/([^/]+)\/?$/;

/** Extracts the room id from `pathname`, or `null` if it doesn't match the `/room/{roomId}` shape. */
export function matchRoomPath(pathname: string): string | null {
  const match = ROOM_PATH_PATTERN.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

/** Non-guessable room ids only (same rationale as `blob-routes.ts`'s share-link blob ids) — a room URL is the only way to discover it, so a short/sequential id would make room enumeration/guessing trivial. */
const ROOM_ID_PATTERN = /^[\w-]{8,128}$/;

/** Routes a WebSocket-upgrade request for `roomId` to its Durable Object instance. Rejects a malformed room id or a non-WebSocket request before ever touching the DO namespace. */
export async function handleRoomUpgrade(request: Request, roomId: string, rooms: RoomNamespace): Promise<Response> {
  if (!ROOM_ID_PATTERN.test(roomId)) return new Response("invalid room id", { status: 400 });
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("expected a WebSocket upgrade request", { status: 426 });
  }

  const stub = rooms.get(rooms.idFromName(roomId));
  return stub.fetch(request);
}
