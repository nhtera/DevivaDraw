import { describe, expect, it } from "vitest";
import worker from "./index";
import type { Env } from "./index";
import type { BlobStore } from "./blob-routes";
import type { RoomNamespace } from "./room-routes";

function fakeEnv(): Env {
  const data = new Map<string, ArrayBuffer>();
  const store: BlobStore = {
    async head(key) {
      return data.has(key) ? {} : null;
    },
    async put(key, value) {
      data.set(key, value);
      return {};
    },
    async get(key) {
      const value = data.get(key);
      if (!value) return null;
      return { arrayBuffer: async () => value };
    },
  };
  // Not exercised by the blob-route tests below (routing to it is `room-routes.test.ts`'s job) —
  // present only so `fakeEnv()` satisfies `Env`'s shape.
  // Node's Fetch polyfill (this test's runtime) rejects constructing a real `status: 101` Response
  // outside an actual protocol upgrade — see `room-routes.test.ts`'s fake for the same note. `200`
  // stands in here purely to prove routing reached the DO stub, not the DO's real upgrade response.
  const rooms: RoomNamespace = {
    idFromName: (name) => name,
    get: () => ({ fetch: async () => new Response(null, { status: 200 }) }),
  };
  return { SHARE_BLOBS: store, ROOMS: rooms };
}

const VALID_BLOB_ID = "550e8400-e29b-41d4-a716-446655440000";
const ALLOWED_ORIGIN = "https://draw.deviva.app";

describe("worker fetch — health check", () => {
  it("responds ok for a path with no blob route", async () => {
    const response = await worker.fetch(new Request("https://collab.example/"), fakeEnv());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("deviva-draw-collab ok");
  });
});

describe("worker fetch — CORS", () => {
  it("echoes an allow-listed origin back in access-control-allow-origin", async () => {
    const response = await worker.fetch(new Request("https://collab.example/", { headers: { origin: ALLOWED_ORIGIN } }), fakeEnv());
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
  });

  it("omits CORS headers entirely for a non-allow-listed origin", async () => {
    const response = await worker.fetch(new Request("https://collab.example/", { headers: { origin: "https://evil.example" } }), fakeEnv());
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("answers a preflight OPTIONS request with 204 and CORS headers", async () => {
    const response = await worker.fetch(
      new Request(`https://collab.example/blobs/${VALID_BLOB_ID}`, { method: "OPTIONS", headers: { origin: ALLOWED_ORIGIN } }),
      fakeEnv(),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("PUT");
  });
});

describe("worker fetch — /blobs/{id} dispatch", () => {
  it("routes PUT to handlePutBlob and GET to handleGetBlob for the same id", async () => {
    const env = fakeEnv();
    const bytes = new Uint8Array([1, 2, 3]);
    const putResponse = await worker.fetch(
      new Request(`https://collab.example/blobs/${VALID_BLOB_ID}`, { method: "PUT", body: bytes, headers: { "content-type": "application/octet-stream" } }),
      env,
    );
    expect(putResponse.status).toBe(204);

    const getResponse = await worker.fetch(new Request(`https://collab.example/blobs/${VALID_BLOB_ID}`), env);
    expect(getResponse.status).toBe(200);
    expect(new Uint8Array(await getResponse.arrayBuffer())).toEqual(bytes);
  });

  it("rejects an unsupported method with 405", async () => {
    const response = await worker.fetch(new Request(`https://collab.example/blobs/${VALID_BLOB_ID}`, { method: "DELETE" }), fakeEnv());
    expect(response.status).toBe(405);
  });

  it("falls back to a shared 'local-dev' rate-limit bucket when cf-connecting-ip is absent", async () => {
    // Regression guard: a missing header must never throw or bypass the limiter entirely.
    const response = await worker.fetch(new Request(`https://collab.example/blobs/${VALID_BLOB_ID}`), fakeEnv());
    expect(response.status).toBe(404); // no blob stored yet, but the request completed without error
  });
});

describe("worker fetch — /room/{id} dispatch", () => {
  const VALID_ROOM_ID = "550e8400-e29b-41d4-a716-446655440001";

  it("routes a WebSocket-upgrade request to the room's Durable Object", async () => {
    const response = await worker.fetch(new Request(`https://collab.example/room/${VALID_ROOM_ID}`, { headers: { upgrade: "websocket" } }), fakeEnv());
    expect(response.status).toBe(200);
  });

  it("rejects a non-WebSocket request to a room path with 426", async () => {
    const response = await worker.fetch(new Request(`https://collab.example/room/${VALID_ROOM_ID}`), fakeEnv());
    expect(response.status).toBe(426);
  });
});
