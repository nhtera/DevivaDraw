/**
 * Deviva Draw collaboration backend. Currently hosts only the R2-backed share-link blob store
 * (`blob-routes.ts`) — Durable Objects room coordination arrives with the collab phase. Every route
 * this Worker exposes is intentionally dumb (see `blob-routes.ts`'s module doc): the server never
 * parses or understands what it stores, by design. This file is the thin runtime-specific wiring layer
 * only: parsing the request path, resolving CORS, and dispatching to the hermetic handler functions —
 * every actual decision (validation, size limits, rate limiting) lives in `blob-routes.ts`/
 * `rate-limit.ts`, which is why those stay unit-testable without a Workers runtime at all.
 */
import { handleGetBlob, handlePutBlob } from "./blob-routes";
import type { BlobStore } from "./blob-routes";
import { RateLimiter } from "./rate-limit";

export interface Env {
  SHARE_BLOBS: BlobStore;
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

/** CORS response headers for `origin`, or `{}` (no CORS headers at all) when `origin` is absent/not allow-listed — an unlisted origin's browser request is then blocked by the browser's own CORS enforcement, not by this Worker refusing to respond. */
function corsHeaders(origin: string | null): HeadersInit {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, PUT, OPTIONS",
    "access-control-allow-headers": "content-type",
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
    else response = new Response("method not allowed", { status: 405 });

    return withCors(response, headers);
  },
} satisfies ExportedHandler<Env>;
