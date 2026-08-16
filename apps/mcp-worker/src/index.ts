/**
 * Worker entry: transport plumbing only — CORS, method gating, per-IP rate limiting, the request
 * body size cap — with every protocol decision delegated to `mcp-handler.ts` (hermetic, tested
 * without a Workers runtime). Stateless end to end: no bindings, no storage, no scene logging.
 */
import { handleJsonRpc, parseJsonRpcBody } from "./mcp-handler";
import { RateLimiter } from "./rate-limit";

/** ~2MB request cap — a full scene round-trips in the body, but nothing legitimate needs more. */
const MAX_BODY_BYTES = 2_000_000;

/** Per-IP budget; generous for an agent loop, hostile to free-compute abuse. */
const rateLimiter = new RateLimiter({ maxRequests: 120, windowMs: 60_000 });

/**
 * Permissive CORS on purpose (unlike collab-server's origin allowlist): an MCP endpoint is meant
 * to be reachable from any client, including browser-based MCP inspectors, there are no
 * credentials/cookies to protect, and the server holds no data — the rate limiter is the abuse
 * control. Headers cover the MCP spec's protocol-version header.
 */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-protocol-version",
  "access-control-max-age": "86400",
};

function withCors(response: Response): Response {
  const wrapped = new Response(response.body, response);
  for (const [key, value] of Object.entries(CORS_HEADERS)) wrapped.headers.set(key, value);
  return wrapped;
}

function plainError(status: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }, { status });
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });

  // Accept both `/` and `/mcp` so `claude mcp add --transport http <host>` works with or without
  // the conventional path suffix.
  if (url.pathname !== "/" && url.pathname !== "/mcp") return plainError(404, "not found — POST MCP JSON-RPC to / or /mcp");
  if (request.method === "GET") {
    // No server-initiated SSE stream on a stateless endpoint — 405 per the Streamable HTTP spec.
    return plainError(405, "GET is not supported — this is a stateless MCP endpoint; POST JSON-RPC messages");
  }
  if (request.method !== "POST") return plainError(405, "method not allowed");

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (!rateLimiter.allow(ip)) return plainError(429, "rate limit exceeded — slow down");

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) return plainError(413, `request body exceeds the ${MAX_BODY_BYTES / 1_000_000}MB cap`);
  // A lying/absent content-length still buffers the body before this re-check — the app-level cap
  // is a rejection filter; the Workers platform body limit is the actual memory backstop.
  const raw = await request.text();
  // Measured in UTF-8 BYTES (not string .length — UTF-16 code units undercount multi-byte text by
  // up to 3x, which would quietly stretch the "2MB" cap to ~6MB of real payload).
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return plainError(413, `request body exceeds the ${MAX_BODY_BYTES / 1_000_000}MB cap`);
  }

  const parsed = parseJsonRpcBody(raw);
  if (parsed instanceof Response) return parsed;

  const response = await handleJsonRpc(parsed);
  // Notifications/responses get 202 Accepted with no body, per the Streamable HTTP transport.
  return response ?? new Response(null, { status: 202 });
}

export default {
  async fetch(request: Request): Promise<Response> {
    return withCors(await handle(request));
  },
};
