/**
 * Deviva Draw collaboration backend: the R2-backed share-link blob store (`blob-routes.ts`) and the
 * Durable Objects live-collaboration room relay (`room-durable-object.ts`/`room-routes.ts`). Every
 * route this Worker exposes is intentionally dumb (see `blob-routes.ts`'s and
 * `room-connection-registry.ts`'s module docs): the server never parses or understands the ciphertext
 * it stores or relays, by design. This file is the thin runtime-specific wiring layer only: parsing the
 * request path, resolving CORS, and dispatching to the hermetic handler functions — every actual
 * decision (validation, size limits, rate limiting, relay logic) lives in those modules, which is why
 * they stay unit-testable without a Workers runtime at all.
 */
import { DELETE_TOKEN_HASH_HEADER, DELETE_TOKEN_HEADER, EXPIRES_AT_HEADER, handleDeleteBlob, handleGetBlob, handlePutBlob } from "./blob-routes";
import type { BlobStore } from "./blob-routes";
import { RateLimiter } from "./rate-limit";
import { CREATE_ROOM_PATH, handleCreateRoom, handleRoomUpgrade, matchRoomPath } from "./room-routes";
import type { RoomNamespace } from "./room-routes";
export { RoomDO } from "./room-durable-object";

export interface Env {
  SHARE_BLOBS: BlobStore;
  ROOMS: RoomNamespace;
  /** Secret that signs room role tokens (`room-role-token.ts`). Provisioned with `wrangler secret put ROOM_TOKEN_SECRET`; `POST /room` fails closed without it. */
  ROOM_TOKEN_SECRET?: string;
}

/**
 * Origins allowed to call this Worker's API from a browser — the standalone app's production and
 * local-dev origins. Locked down rather than `*`: this endpoint accepts writes (an abuse surface) even
 * though every write is opaque ciphertext the server can't inspect.
 */
const ALLOWED_ORIGINS = new Set(["https://draw.deviva.app", "http://localhost:5173"]);

const BLOB_PATH_PATTERN = /^\/blobs\/([^/]+)$/;

// Module-scope (one instance per Worker isolate, not per-request) — see `rate-limit.ts`'s module doc
// for why per-isolate state is an accepted V1 tradeoff. Separate limiters for GET/PUT since abusing
// "fill R2 with junk" (PUT) and "brute-force blob ids" (GET) are different threats with different
// acceptable request rates.
const putLimiter = new RateLimiter({ maxRequests: 20, windowMs: 60_000 });
const getLimiter = new RateLimiter({ maxRequests: 60, windowMs: 60_000 });
// Its own limiter (not PUT's): revocation attempts are a token-guessing surface, and sharing PUT's
// bucket would let a revoke-spammer starve legitimate share creation from the same address.
const deleteLimiter = new RateLimiter({ maxRequests: 20, windowMs: 60_000 });
const createRoomLimiter = new RateLimiter({ maxRequests: 30, windowMs: 60_000 });

/**
 * CORS response headers for `origin`, or `{}` (no CORS headers at all) when `origin` is absent/not
 * allow-listed — an unlisted origin's browser request is then blocked by the browser's own CORS
 * enforcement, not by this Worker refusing to respond. The method/header allow-lists stay explicit
 * enumerations (never reflected from the preflight's requested values): every custom header a client
 * sends forces a preflight, and a header missing from this list bricks the request in the browser
 * before it's ever sent — so any new `x-deviva-*` header MUST be added here to work at all.
 */
function corsHeaders(origin: string | null): HeadersInit {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": `content-type, ${DELETE_TOKEN_HASH_HEADER}, ${DELETE_TOKEN_HEADER}, ${EXPIRES_AT_HEADER}`,
    vary: "origin",
  };
}

function withCors(response: Response, headers: HeadersInit): Response {
  const merged = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) merged.headers.set(key, value);
  return merged;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = corsHeaders(request.headers.get("origin"));

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    // WebSocket upgrades never carry a CORS-relevant response (the 101 Switching Protocols response
    // has no headers a browser's CORS check inspects), so this route bypasses `withCors` entirely —
    // it's handled before the CORS-wrapped blob/health-check dispatch below rather than folded into it.
    const roomId = matchRoomPath(url.pathname);
    if (roomId !== null) return handleRoomUpgrade(request, roomId, env.ROOMS);

    // Minting a room IS a CORS-relevant browser request (unlike the upgrade above), so it goes through
    // `withCors`. Rate-limited on its own bucket: it is cheap for the server but it is also the one
    // unauthenticated endpoint that performs crypto, and sharing PUT's bucket would let a session-spammer
    // starve share-link creation.
    if (url.pathname === CREATE_ROOM_PATH && request.method === "POST") {
      const clientIp = request.headers.get("cf-connecting-ip") ?? "local-dev";
      if (!createRoomLimiter.allow(clientIp)) return withCors(new Response("rate limit exceeded", { status: 429 }), headers);
      return withCors(await handleCreateRoom(env.ROOM_TOKEN_SECRET), headers);
    }

    const blobMatch = BLOB_PATH_PATTERN.exec(url.pathname);
    if (!blobMatch) return withCors(new Response("deviva-draw-collab ok", { status: 200 }), headers);

    const blobId = blobMatch[1]!;
    // `cf-connecting-ip` is set by Cloudflare's network edge on every real request; absent only in
    // local `wrangler dev`/tests, where every caller shares one bucket — an accepted V1 dev-only gap,
    // not a production rate-limit bypass.
    const clientIp = request.headers.get("cf-connecting-ip") ?? "local-dev";
    const deps = { store: env.SHARE_BLOBS, clientIp };

    let response: Response;
    if (request.method === "PUT") response = await handlePutBlob(request, blobId, { ...deps, limiter: putLimiter });
    else if (request.method === "GET") response = await handleGetBlob(blobId, { ...deps, limiter: getLimiter });
    else if (request.method === "DELETE") response = await handleDeleteBlob(request, blobId, { ...deps, limiter: deleteLimiter });
    else response = new Response("method not allowed", { status: 405 });

    return withCors(response, headers);
  },
} satisfies ExportedHandler<Env>;
