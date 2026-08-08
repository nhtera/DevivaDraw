/**
 * The dumb, content-agnostic ciphertext store behind share links: `PUT /blobs/{id}` writes bytes,
 * `GET /blobs/{id}` reads them back. Neither route parses or inspects what it stores — the payload is
 * always AES-GCM ciphertext the client encrypted with a key that never reaches this Worker (see
 * `@deviva-draw/engine`'s `share-link/` module), so there is nothing here to "understand" even in
 * principle. Blob ids are client-generated UUIDs, never sequential/short ids, so knowing (or guessing)
 * one is required to fetch it — this module only validates the shape of whatever id the client already
 * chose; it never mints or tracks ids itself.
 *
 * No auto-expiry in V1 (a deliberate simplification, not an oversight) — a TTL would hook in here via
 * an R2 bucket lifecycle rule (bucket-level config, no code change) once a retention policy is decided.
 *
 * `store`/`limiter`/`clientIp` are injected per call (`BlobRouteDeps`) rather than read from module-
 * level globals, so these handlers are plain, hermetic functions testable with an in-memory fake store
 * and no real R2 bucket or Workers runtime — `index.ts` is the only place that wires the real R2
 * binding and `cf-connecting-ip` header in.
 */
import type { RateLimiter } from "./rate-limit";

/**
 * Conservative cap mirroring the client's own `MAX_SHARE_PAYLOAD_BYTES`
 * (`@deviva-draw/engine`'s `share-link/encrypt-scene.ts`) — enforced again here since a client-side
 * check alone is trivially bypassed by anyone calling this endpoint directly.
 */
export const MAX_BLOB_BYTES = 15 * 1024 * 1024;

/** UUIDs (with or without hyphens) plus a little slack for other non-guessable id schemes — never a sequential/short id, so a stray digit typo can't accidentally hit another user's blob. */
const BLOB_ID_PATTERN = /^[\w-]{8,128}$/;

/**
 * The subset of Cloudflare's real `R2Bucket` interface these handlers actually use — kept minimal and
 * hand-written (rather than importing `R2Bucket` directly) so tests can inject a trivial in-memory fake
 * instead of a real Workers runtime/R2 binding. A real `R2Bucket` satisfies this structurally: `head`
 * is R2's own cheap metadata-only existence check (no body transfer), used here instead of `get` so
 * the overwrite guard below never pays for reading bytes it's about to discard.
 */
export interface BlobStore {
  head(key: string): Promise<unknown | null>;
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

export interface BlobRouteDeps {
  store: BlobStore;
  limiter: RateLimiter;
  /** Rate-limit bucket key — the caller (`index.ts`) derives this from `cf-connecting-ip`, falling back to a shared key when that header is absent (local dev). */
  clientIp: string;
  /** Overrides `MAX_BLOB_BYTES` — primarily for tests exercising the size guard without streaming multi-megabyte bodies. */
  maxBodyBytes?: number;
}

function isValidBlobId(id: string): boolean {
  return BLOB_ID_PATTERN.test(id);
}

/** Terminal result of `readBoundedBody`: either the fully-buffered bytes, or a signal that the cap was hit — the caller never sees a partially-read body pretending to be complete. */
type ReadBoundedBodyResult = { ok: true; bytes: Uint8Array } | { ok: false; tooLarge: true };

/**
 * Reads `request`'s body via its stream reader, chunk by chunk, aborting (and canceling the reader —
 * no reading past the point of failure) the instant the accumulated byte count exceeds `maxBytes`. A
 * chunked-transfer body has no `content-length` header for the fast pre-check below to catch, so
 * without this streaming cap a malicious/broken client could force the full body into memory before
 * the post-hoc `byteLength` check ever ran.
 */
async function readBoundedBody(request: Request, maxBytes: number): Promise<ReadBoundedBodyResult> {
  const reader = request.body?.getReader();
  if (!reader) return { ok: true, bytes: new Uint8Array() };

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, tooLarge: true };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export async function handlePutBlob(request: Request, blobId: string, deps: BlobRouteDeps): Promise<Response> {
  if (!isValidBlobId(blobId)) return new Response("invalid blob id", { status: 400 });
  if (!deps.limiter.allow(`put:${deps.clientIp}`)) return new Response("rate limit exceeded", { status: 429 });

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType !== "application/octet-stream") return new Response("content-type must be application/octet-stream", { status: 415 });

  const maxBodyBytes = deps.maxBodyBytes ?? MAX_BLOB_BYTES;
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) return new Response("payload too large", { status: 413 });

  // Blob ids travel in URL paths (visible in access logs, the `referer` header of a page that embeds
  // a link, etc.), so anyone who can see one could otherwise silently overwrite (and so break) an
  // existing share link — checked before consuming the body so a doomed request never pays for it.
  if (await deps.store.head(blobId)) return new Response("blob already exists", { status: 409 });

  const bodyResult = await readBoundedBody(request, maxBodyBytes);
  if (!bodyResult.ok) return new Response("payload too large", { status: 413 });
  if (bodyResult.bytes.byteLength === 0) return new Response("empty payload", { status: 400 });

  // See `@deviva-draw/engine`'s `gzip-codec.ts` for why `Uint8Array`'s `.buffer` needs this cast:
  // `bytes` was allocated fresh above (`new Uint8Array(total)`), so it's always exactly
  // `ArrayBuffer`-backed even though the type is generic over the wider `ArrayBufferLike`.
  await deps.store.put(blobId, bodyResult.bytes.buffer as ArrayBuffer, { httpMetadata: { contentType: "application/octet-stream" } });
  return new Response(null, { status: 204 });
}

export async function handleGetBlob(blobId: string, deps: BlobRouteDeps): Promise<Response> {
  if (!isValidBlobId(blobId)) return new Response("invalid blob id", { status: 400 });
  if (!deps.limiter.allow(`get:${deps.clientIp}`)) return new Response("rate limit exceeded", { status: 429 });

  const object = await deps.store.get(blobId);
  if (!object) return new Response("not found", { status: 404 });

  const bytes = await object.arrayBuffer();
  return new Response(bytes, { status: 200, headers: { "content-type": "application/octet-stream" } });
}
