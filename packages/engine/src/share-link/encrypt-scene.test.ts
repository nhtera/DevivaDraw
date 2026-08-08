import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, SCENE_DOCUMENT_TYPE } from "../persistence/scene-schema";
import type { SceneDocumentV1 } from "../persistence/scene-schema";
import { createRectangleElement } from "../elements/shape-elements";
import { encryptSceneDocument, MAX_SHARE_PAYLOAD_BYTES, ShareScenePayloadTooLargeError } from "./encrypt-scene";

function fixtureDocument(marker = "distinctive-plaintext-marker"): SceneDocumentV1 {
  return {
    type: SCENE_DOCUMENT_TYPE,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    elements: [createRectangleElement({ x: 0, y: 0, width: 10, height: 10, link: marker })],
    files: {},
  };
}

describe("encryptSceneDocument", () => {
  it("returns ciphertext plus base64url key/IV material", async () => {
    const result = await encryptSceneDocument(fixtureDocument());
    expect(result.ciphertext).toBeInstanceOf(Uint8Array);
    expect(result.ciphertext.byteLength).toBeGreaterThan(0);
    expect(result.keyBase64Url).toMatch(/^[\w-]+$/);
    expect(result.ivBase64Url).toMatch(/^[\w-]+$/);
  });

  it("generates a fresh, unique key and IV on every call — even for the identical document", async () => {
    const document = fixtureDocument();
    const runs = await Promise.all(Array.from({ length: 8 }, () => encryptSceneDocument(document)));
    expect(new Set(runs.map((r) => r.keyBase64Url)).size).toBe(runs.length);
    expect(new Set(runs.map((r) => r.ivBase64Url)).size).toBe(runs.length);
  });

  it("produces ciphertext that never contains the plaintext scene content as a substring", async () => {
    const marker = "super-secret-plaintext-marker-xyz";
    const { ciphertext } = await encryptSceneDocument(fixtureDocument(marker));
    const ciphertextAsLatin1 = Array.from(ciphertext, (byte) => String.fromCharCode(byte)).join("");
    expect(ciphertextAsLatin1).not.toContain(marker);
  });

  it("produces ciphertext that never contains the key or IV it was encrypted with", async () => {
    const { ciphertext, keyBase64Url, ivBase64Url } = await encryptSceneDocument(fixtureDocument());
    const ciphertextAsLatin1 = Array.from(ciphertext, (byte) => String.fromCharCode(byte)).join("");
    expect(ciphertextAsLatin1).not.toContain(keyBase64Url);
    expect(ciphertextAsLatin1).not.toContain(ivBase64Url);
  });

  it("exports the documented default size cap", () => {
    expect(MAX_SHARE_PAYLOAD_BYTES).toBe(15 * 1024 * 1024);
  });

  it("throws ShareScenePayloadTooLargeError before returning when the ciphertext exceeds maxPayloadBytes", async () => {
    await expect(encryptSceneDocument(fixtureDocument(), { maxPayloadBytes: 4 })).rejects.toBeInstanceOf(ShareScenePayloadTooLargeError);
  });

  it("ShareScenePayloadTooLargeError carries the actual and max sizes", async () => {
    try {
      await encryptSceneDocument(fixtureDocument(), { maxPayloadBytes: 4 });
      expect.fail("expected encryptSceneDocument to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ShareScenePayloadTooLargeError);
      const typedError = error as ShareScenePayloadTooLargeError;
      expect(typedError.maxSizeBytes).toBe(4);
      expect(typedError.sizeBytes).toBeGreaterThan(4);
    }
  });
});
