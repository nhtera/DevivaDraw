import { describe, expect, it } from "vitest";
import { handleDeleteBlob, handleGetBlob, handlePutBlob, MAX_BLOB_BYTES } from "./blob-routes";
import type { BlobStore } from "./blob-routes";
import { RateLimiter } from "./rate-limit";

/** In-memory fake satisfying the minimal `BlobStore` interface — no real R2 bucket or Workers runtime needed to exercise `blob-routes.ts`'s actual decision logic. Stores `customMetadata` per key, mirroring R2's behavior of returning it from both `head` and `get`. */
function fakeStore(): BlobStore & { data: Map<string, ArrayBuffer>; metadata: Map<string, Record<string, string>> } {
  const data = new Map<string, ArrayBuffer>();
  const metadata = new Map<string, Record<string, string>>();
  return {
    data,
    metadata,
    async head(key) {
      return data.has(key) ? { customMetadata: metadata.get(key) } : null;
    },
    async put(key, value, options) {
      data.set(key, value);
      if (options?.customMetadata) metadata.set(key, options.customMetadata);
      return {};
    },
    async get(key) {
      const value = data.get(key);
      if (!value) return null;
      return { arrayBuffer: async () => value, customMetadata: metadata.get(key) };
    },
    async delete(key) {
      data.delete(key);
      metadata.delete(key);
      return undefined;
    },
  };
}

function unlimitedLimiter(): RateLimiter {
  return new RateLimiter({ maxRequests: Number.MAX_SAFE_INTEGER, windowMs: 60_000 });
}

const VALID_BLOB_ID = "550e8400-e29b-41d4-a716-446655440000";

function putRequest(body: BodyInit | null, headers: Record<string, string> = { "content-type": "application/octet-stream" }): Request {
  const init: RequestInit & { duplex?: "half" } = { method: "PUT", body, headers };
  // `duplex: "half"` is required by the Fetch spec whenever a `Request` carries a streaming
  // (`ReadableStream`) body — Cloudflare's `RequestInit` type doesn't declare it (Workers doesn't need
  // it), but the Node runtime these tests execute under does enforce it at construction time.
  if (body instanceof ReadableStream) init.duplex = "half";
  return new Request("https://collab.example/blobs/x", init as RequestInit);
}

/** A `ReadableStream` that hands out `chunkSize`-byte chunks forever (until canceled) — simulates a chunked-transfer body with no `content-length` header, and counts how many chunks were actually pulled so a test can prove `readBoundedBody` stopped reading early instead of buffering the whole (effectively unbounded) stream. */
function unboundedChunkedBody(chunkSize: number): { stream: ReadableStream<Uint8Array>; pullCount(): number } {
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(chunkSize));
    },
  });
  return { stream, pullCount: () => pulls };
}

describe("handlePutBlob", () => {
  it("stores the request body and returns 204 for a valid request", async () => {
    const store = fakeStore();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const response = await handlePutBlob(putRequest(bytes), VALID_BLOB_ID, { store, limiter: unlimitedLimiter(), clientIp: "1.2.3.4" });

    expect(response.status).toBe(204);
    expect(new Uint8Array(store.data.get(VALID_BLOB_ID)!)).toEqual(bytes);
  });

  it("rejects an invalid blob id with 400", async () => {
    const response = await handlePutBlob(putRequest(new Uint8Array([1])), "../../etc/passwd", { store: fakeStore(), limiter: unlimitedLimiter(), clientIp: "1.2.3.4" });
    expect(response.status).toBe(400);
  });

  it("rejects a wrong content-type with 415", async () => {
    const response = await handlePutBlob(putRequest(new Uint8Array([1]), { "content-type": "application/json" }), VALID_BLOB_ID, {
      store: fakeStore(),
      limiter: unlimitedLimiter(),
      clientIp: "1.2.3.4",
    });
    expect(response.status).toBe(415);
  });

  it("rejects an empty body with 400", async () => {
    const response = await handlePutBlob(putRequest(new Uint8Array()), VALID_BLOB_ID, { store: fakeStore(), limiter: unlimitedLimiter(), clientIp: "1.2.3.4" });
    expect(response.status).toBe(400);
  });

  it("rejects a body exceeding MAX_BLOB_BYTES with 413", async () => {
    const oversized = new Uint8Array(MAX_BLOB_BYTES + 1);
    const response = await handlePutBlob(putRequest(oversized), VALID_BLOB_ID, { store: fakeStore(), limiter: unlimitedLimiter(), clientIp: "1.2.3.4" });
    expect(response.status).toBe(413);
  });

  it("fast-413s an honest oversized content-length before touching the store or reading the body", async () => {
    const store = fakeStore();
    const response = await handlePutBlob(
      putRequest(new Uint8Array([1, 2, 3]), { "content-type": "application/octet-stream", "content-length": "1000" }),
      VALID_BLOB_ID,
      { store, limiter: unlimitedLimiter(), clientIp: "1.2.3.4", maxBodyBytes: 100 },
    );
    expect(response.status).toBe(413);
    expect(store.data.has(VALID_BLOB_ID)).toBe(false);
  });

  it("rejects when a spoofed content-length header claims an oversized body, without reading the body", async () => {
    const store = fakeStore();
    const response = await handlePutBlob(putRequest(new Uint8Array([1, 2, 3]), { "content-type": "application/octet-stream", "content-length": String(MAX_BLOB_BYTES + 1) }), VALID_BLOB_ID, {
      store,
      limiter: unlimitedLimiter(),
      clientIp: "1.2.3.4",
    });
    expect(response.status).toBe(413);
    expect(store.data.has(VALID_BLOB_ID)).toBe(false);
  });

  it("aborts a chunked body with no content-length once accumulated bytes exceed maxBodyBytes, without buffering past the cap", async () => {
    const { stream, pullCount } = unboundedChunkedBody(1024);
    const store = fakeStore();

    const response = await handlePutBlob(putRequest(stream, { "content-type": "application/octet-stream" }), VALID_BLOB_ID, {
      store,
      limiter: unlimitedLimiter(),
      clientIp: "1.2.3.4",
      maxBodyBytes: 4096,
    });

    expect(response.status).toBe(413);
    expect(store.data.has(VALID_BLOB_ID)).toBe(false);
    // With 1024-byte chunks and a 4096-byte cap, reading must stop within a handful of chunks — proof
    // this never drained the (endless) stream before checking the size, unlike a naive
    // `request.arrayBuffer()` call would.
    expect(pullCount()).toBeLessThan(10);
  });

  it("returns 409 without overwriting when the blob id already exists", async () => {
    const store = fakeStore();
    const deps = { store, limiter: unlimitedLimiter(), clientIp: "1.2.3.4" };
    const original = new Uint8Array([1, 1, 1]);
    const first = await handlePutBlob(putRequest(original), VALID_BLOB_ID, deps);
    expect(first.status).toBe(204);

    const second = await handlePutBlob(putRequest(new Uint8Array([9, 9, 9])), VALID_BLOB_ID, deps);

    expect(second.status).toBe(409);
    expect(new Uint8Array(store.data.get(VALID_BLOB_ID)!)).toEqual(original);
  });

  it("returns 429 once the caller's rate limit is exceeded", async () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const deps = { store: fakeStore(), limiter, clientIp: "1.2.3.4" };
    const first = await handlePutBlob(putRequest(new Uint8Array([1])), VALID_BLOB_ID, deps);
    const second = await handlePutBlob(putRequest(new Uint8Array([1])), VALID_BLOB_ID, deps);
    expect(first.status).toBe(204);
    expect(second.status).toBe(429);
  });

  it("rate-limits PUT and GET independently per caller (separate limiter instances, see index.ts)", async () => {
    const putLimiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const getLimiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const store = fakeStore();
    await handlePutBlob(putRequest(new Uint8Array([1])), VALID_BLOB_ID, { store, limiter: putLimiter, clientIp: "1.2.3.4" });
    const getResponse = await handleGetBlob(VALID_BLOB_ID, { store, limiter: getLimiter, clientIp: "1.2.3.4" });
    expect(getResponse.status).toBe(200);
  });
});

describe("handleGetBlob", () => {
  it("returns the stored bytes with an octet-stream content-type", async () => {
    const store = fakeStore();
    const bytes = new Uint8Array([9, 8, 7]);
    await store.put(VALID_BLOB_ID, bytes.buffer);

    const response = await handleGetBlob(VALID_BLOB_ID, { store, limiter: unlimitedLimiter(), clientIp: "1.2.3.4" });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("returns 404 for a blob that was never stored (expired/never-created link)", async () => {
    const response = await handleGetBlob(VALID_BLOB_ID, { store: fakeStore(), limiter: unlimitedLimiter(), clientIp: "1.2.3.4" });
    expect(response.status).toBe(404);
  });

  it("rejects an invalid blob id with 400 without touching the store", async () => {
    const response = await handleGetBlob("not a valid id!!", { store: fakeStore(), limiter: unlimitedLimiter(), clientIp: "1.2.3.4" });
    expect(response.status).toBe(400);
  });

  it("returns 429 once the caller's GET rate limit is exceeded", async () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const deps = { store: fakeStore(), limiter, clientIp: "9.9.9.9" };
    const first = await handleGetBlob(VALID_BLOB_ID, deps);
    const second = await handleGetBlob(VALID_BLOB_ID, deps);
    expect(first.status).toBe(404); // not found, but still counted against the limiter
    expect(second.status).toBe(429);
  });
});

describe("handleDeleteBlob (revocable share links)", () => {
  const tokenBytes = new Uint8Array(32).fill(7);
  const toBase64Url = (bytes: Uint8Array) => {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  };
  const token = toBase64Url(tokenBytes);
  const tokenHash = async () => toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", tokenBytes)));

  const deleteRequest = (presentedToken?: string) =>
    new Request("https://collab.example/blobs/x", { method: "DELETE", headers: presentedToken !== undefined ? { "x-deviva-delete-token": presentedToken } : {} });

  async function storeWithRevocableBlob(): Promise<ReturnType<typeof fakeStore>> {
    const store = fakeStore();
    const response = await handlePutBlob(
      putRequest(new Uint8Array([1, 2, 3]), { "content-type": "application/octet-stream", "x-deviva-delete-token-hash": await tokenHash() }),
      VALID_BLOB_ID,
      { store, limiter: unlimitedLimiter(), clientIp: "1.2.3.4" },
    );
    expect(response.status).toBe(204);
    return store;
  }

  it("deletes the blob (204) when the presented token hashes to the stored value, and the blob then 404s", async () => {
    const store = await storeWithRevocableBlob();
    const deps = { store, limiter: unlimitedLimiter(), clientIp: "1.2.3.4" };

    const response = await handleDeleteBlob(deleteRequest(token), VALID_BLOB_ID, deps);
    expect(response.status).toBe(204);
    expect(store.data.has(VALID_BLOB_ID)).toBe(false);
    expect((await handleGetBlob(VALID_BLOB_ID, deps)).status).toBe(404);
  });

  it("rejects a wrong token with 403 and leaves the blob in place", async () => {
    const store = await storeWithRevocableBlob();
    const wrongToken = toBase64Url(new Uint8Array(32).fill(8));
    const response = await handleDeleteBlob(deleteRequest(wrongToken), VALID_BLOB_ID, { store, limiter: unlimitedLimiter(), clientIp: "1.2.3.4" });
    expect(response.status).toBe(403);
    expect(store.data.has(VALID_BLOB_ID)).toBe(true);
  });

  it("rejects a missing or malformed token with 400", async () => {
    const store = await storeWithRevocableBlob();
    const deps = { store, limiter: unlimitedLimiter(), clientIp: "1.2.3.4" };
    expect((await handleDeleteBlob(deleteRequest(), VALID_BLOB_ID, deps)).status).toBe(400);
    expect((await handleDeleteBlob(deleteRequest("short"), VALID_BLOB_ID, deps)).status).toBe(400);
    expect(store.data.has(VALID_BLOB_ID)).toBe(true);
  });

  it("404s for an absent blob but 403s for a legacy blob that stored no hash — never a false 'already revoked'", async () => {
    const store = fakeStore();
    const deps = { store, limiter: unlimitedLimiter(), clientIp: "1.2.3.4" };
    expect((await handleDeleteBlob(deleteRequest(token), VALID_BLOB_ID, deps)).status).toBe(404);

    // Legacy PUT without the hash header — accepted, but permanently non-revocable.
    await handlePutBlob(putRequest(new Uint8Array([9])), VALID_BLOB_ID, deps);
    const response = await handleDeleteBlob(deleteRequest(token), VALID_BLOB_ID, deps);
    expect(response.status).toBe(403);
    expect(store.data.has(VALID_BLOB_ID)).toBe(true);
  });

  it("is rate limited independently", async () => {
    const store = await storeWithRevocableBlob();
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const deps = { store, limiter, clientIp: "1.2.3.4" };
    await handleDeleteBlob(deleteRequest(token), VALID_BLOB_ID, deps);
    expect((await handleDeleteBlob(deleteRequest(token), VALID_BLOB_ID, deps)).status).toBe(429);
  });

  it("PUT rejects a malformed delete-token hash with 400 instead of minting an unrevocable 'revocable' link", async () => {
    const store = fakeStore();
    const response = await handlePutBlob(
      putRequest(new Uint8Array([1]), { "content-type": "application/octet-stream", "x-deviva-delete-token-hash": "not-a-hash" }),
      VALID_BLOB_ID,
      { store, limiter: unlimitedLimiter(), clientIp: "1.2.3.4" },
    );
    expect(response.status).toBe(400);
    expect(store.data.has(VALID_BLOB_ID)).toBe(false);
  });
});

describe("blob expiry (lazy enforcement on GET)", () => {
  const deps = (store: ReturnType<typeof fakeStore>) => ({ store, limiter: unlimitedLimiter(), clientIp: "1.2.3.4" });

  const putWithExpiry = (store: ReturnType<typeof fakeStore>, expiresAt: string) =>
    handlePutBlob(putRequest(new Uint8Array([1, 2]), { "content-type": "application/octet-stream", "x-deviva-expires-at": expiresAt }), VALID_BLOB_ID, deps(store));

  it("stores a valid future expiry and serves the blob until then", async () => {
    const store = fakeStore();
    const inAWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();
    expect((await putWithExpiry(store, inAWeek)).status).toBe(204);
    expect(store.metadata.get(VALID_BLOB_ID)?.expiresAt).toBe(inAWeek);
    expect((await handleGetBlob(VALID_BLOB_ID, deps(store))).status).toBe(200);
  });

  it("an expired blob 404s and is deleted on that first hit", async () => {
    const store = fakeStore();
    await handlePutBlob(putRequest(new Uint8Array([1, 2])), VALID_BLOB_ID, deps(store));
    // Simulate an already-elapsed lifetime by writing the metadata directly — the PUT validator
    // rightly refuses to create one this stale.
    store.metadata.set(VALID_BLOB_ID, { expiresAt: new Date(Date.now() - 1000).toISOString() });

    expect((await handleGetBlob(VALID_BLOB_ID, deps(store))).status).toBe(404);
    expect(store.data.has(VALID_BLOB_ID)).toBe(false); // storage self-cleaned
  });

  it("rejects garbage, far-past, and over-horizon expiries with 400", async () => {
    const store = fakeStore();
    expect((await putWithExpiry(store, "not-a-date")).status).toBe(400);
    expect((await putWithExpiry(store, new Date(Date.now() - 3_600_000).toISOString())).status).toBe(400);
    expect((await putWithExpiry(store, new Date(Date.now() + 400 * 86_400_000).toISOString())).status).toBe(400);
    expect(store.data.has(VALID_BLOB_ID)).toBe(false);
  });

  it("clamps a slightly-past expiry (clock skew) forward to a minimum lifetime instead of rejecting", async () => {
    const store = fakeStore();
    const skewed = new Date(Date.now() - 60_000).toISOString(); // one minute in the past — a wrong clock, not a wrong request
    expect((await putWithExpiry(store, skewed)).status).toBe(204);
    const stored = Date.parse(store.metadata.get(VALID_BLOB_ID)!.expiresAt!);
    expect(stored).toBeGreaterThan(Date.now());
  });
});
