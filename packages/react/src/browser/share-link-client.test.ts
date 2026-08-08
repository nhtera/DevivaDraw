import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSceneDocument, CURRENT_SCHEMA_VERSION, SCENE_DOCUMENT_TYPE } from "@deviva-draw/engine";
import type { SceneDocumentV1 } from "@deviva-draw/engine";
import { createShareLink, fetchAndDecryptSharedScene } from "./share-link-client";

function fixtureDocument(): SceneDocumentV1 {
  return { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements: [], files: {} };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createShareLink", () => {
  it("PUTs octet-stream ciphertext to {apiBaseUrl}/blobs/{uuid} and returns a URL with the key/iv only in the fragment", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(null, { status: 204 });
      }),
    );

    const url = await createShareLink({ apiBaseUrl: "http://localhost:8788", origin: "https://draw.deviva.app", document: fixtureDocument() });

    expect(capturedUrl).toMatch(/^http:\/\/localhost:8788\/blobs\/[0-9a-f-]{36}$/);
    expect(capturedInit.method).toBe("PUT");
    expect((capturedInit.headers as Record<string, string>)["content-type"]).toBe("application/octet-stream");
    expect(capturedInit.body).toBeInstanceOf(Uint8Array);

    expect(url).toMatch(/^https:\/\/draw\.deviva\.app\/s\/[0-9a-f-]{36}#key=[\w-]+&iv=[\w-]+$/);
  });

  it("strips a trailing slash from apiBaseUrl before building the upload URL", async () => {
    let capturedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return new Response(null, { status: 204 });
      }),
    );
    await createShareLink({ apiBaseUrl: "http://localhost:8788/", origin: "https://draw.deviva.app", document: fixtureDocument() });
    expect(capturedUrl.startsWith("http://localhost:8788/blobs/")).toBe(true);
  });

  it("throws when the upload responds with a non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(createShareLink({ apiBaseUrl: "http://localhost:8788", origin: "https://draw.deviva.app", document: fixtureDocument() })).rejects.toThrow(/status 500/);
  });

  it("never sends the plaintext key/iv anywhere in the request URL, headers, or body", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(null, { status: 204 });
      }),
    );

    const shareUrl = await createShareLink({ apiBaseUrl: "http://localhost:8788", origin: "https://draw.deviva.app", document: fixtureDocument() });
    const fragment = new URL(shareUrl).hash;
    const key = new URLSearchParams(fragment.slice(1)).get("key")!;
    const iv = new URLSearchParams(fragment.slice(1)).get("iv")!;

    expect(capturedUrl).not.toContain(key);
    expect(capturedUrl).not.toContain(iv);
    expect(JSON.stringify(capturedInit.headers)).not.toContain(key);
    expect(JSON.stringify(capturedInit.headers)).not.toContain(iv);
    const bodyBytes = Array.from(capturedInit.body as Uint8Array, (b) => String.fromCharCode(b)).join("");
    expect(bodyBytes).not.toContain(key);
    expect(bodyBytes).not.toContain(iv);
  });
});

describe("fetchAndDecryptSharedScene", () => {
  it("fetches, decrypts, and returns the original document on a valid round trip", async () => {
    const document = fixtureDocument();
    const encrypted = await encryptSceneDocument(document);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(encrypted.ciphertext as Uint8Array<ArrayBuffer>, { status: 200 })));

    const result = await fetchAndDecryptSharedScene({ apiBaseUrl: "http://localhost:8788", blobId: "abc", keyBase64Url: encrypted.keyBase64Url, ivBase64Url: encrypted.ivBase64Url });

    expect(result).toEqual({ ok: true, value: document });
  });

  it("returns reason 'not-found' for a 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const result = await fetchAndDecryptSharedScene({ apiBaseUrl: "http://localhost:8788", blobId: "abc", keyBase64Url: "k", ivBase64Url: "i" });
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("returns reason 'http-error' for a non-404 non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    const result = await fetchAndDecryptSharedScene({ apiBaseUrl: "http://localhost:8788", blobId: "abc", keyBase64Url: "k", ivBase64Url: "i" });
    expect(result).toEqual({ ok: false, reason: "http-error" });
  });

  it("returns reason 'network-error' when fetch itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    const result = await fetchAndDecryptSharedScene({ apiBaseUrl: "http://localhost:8788", blobId: "abc", keyBase64Url: "k", ivBase64Url: "i" });
    expect(result).toEqual({ ok: false, reason: "network-error" });
  });

  it("returns reason 'decrypt-failed' for a wrong key (propagated from decryptSceneCiphertext)", async () => {
    const encrypted = await encryptSceneDocument(fixtureDocument());
    vi.stubGlobal("fetch", vi.fn(async () => new Response(encrypted.ciphertext as Uint8Array<ArrayBuffer>, { status: 200 })));

    const { keyBase64Url: wrongKey } = await encryptSceneDocument(fixtureDocument());
    const result = await fetchAndDecryptSharedScene({ apiBaseUrl: "http://localhost:8788", blobId: "abc", keyBase64Url: wrongKey, ivBase64Url: encrypted.ivBase64Url });
    expect(result).toEqual({ ok: false, reason: "decrypt-failed" });
  });
});
