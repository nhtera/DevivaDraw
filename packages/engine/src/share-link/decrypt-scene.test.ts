import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, SCENE_DOCUMENT_TYPE } from "../persistence/scene-schema";
import type { SceneDocumentV1 } from "../persistence/scene-schema";
import { createRectangleElement } from "../elements/shape-elements";
import { decryptSceneCiphertext } from "./decrypt-scene";
import { encryptSceneDocument } from "./encrypt-scene";

function fixtureDocument(): SceneDocumentV1 {
  return { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements: [createRectangleElement({ x: 0, y: 0, width: 5, height: 5 })], files: {} };
}

describe("decryptSceneCiphertext", () => {
  it("round-trips a document encrypted by encryptSceneDocument", async () => {
    const document = fixtureDocument();
    const { ciphertext, keyBase64Url, ivBase64Url } = await encryptSceneDocument(document);
    const result = await decryptSceneCiphertext(ciphertext, { keyBase64Url, ivBase64Url });
    expect(result).toEqual({ ok: true, value: document });
  });

  it("fails with reason 'decrypt-failed' when the key is wrong", async () => {
    const { ciphertext, ivBase64Url } = await encryptSceneDocument(fixtureDocument());
    const { keyBase64Url: wrongKey } = await encryptSceneDocument(fixtureDocument());
    const result = await decryptSceneCiphertext(ciphertext, { keyBase64Url: wrongKey, ivBase64Url });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("decrypt-failed");
  });

  it("fails with reason 'decrypt-failed' when even a single ciphertext byte is tampered (AES-GCM auth tag)", async () => {
    const { ciphertext, keyBase64Url, ivBase64Url } = await encryptSceneDocument(fixtureDocument());
    const tampered = new Uint8Array(ciphertext);
    tampered[0] = (tampered[0]! ^ 0xff) & 0xff;
    const result = await decryptSceneCiphertext(tampered, { keyBase64Url, ivBase64Url });
    expect(result).toEqual({ ok: false, reason: "decrypt-failed", error: expect.any(String) });
  });

  it("fails with reason 'decrypt-failed' when the last (auth-tag) byte is tampered", async () => {
    const { ciphertext, keyBase64Url, ivBase64Url } = await encryptSceneDocument(fixtureDocument());
    const tampered = new Uint8Array(ciphertext);
    const lastIndex = tampered.length - 1;
    tampered[lastIndex] = (tampered[lastIndex]! ^ 0xff) & 0xff;
    const result = await decryptSceneCiphertext(tampered, { keyBase64Url, ivBase64Url });
    expect(result.ok).toBe(false);
  });

  it("fails with reason 'decrypt-failed' when the IV is wrong", async () => {
    const { ciphertext, keyBase64Url } = await encryptSceneDocument(fixtureDocument());
    const { ivBase64Url: wrongIv } = await encryptSceneDocument(fixtureDocument());
    const result = await decryptSceneCiphertext(ciphertext, { keyBase64Url, ivBase64Url: wrongIv });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("decrypt-failed");
  });

  it("fails gracefully (never throws) on garbage key/IV strings", async () => {
    const result = await decryptSceneCiphertext(new Uint8Array([1, 2, 3]), { keyBase64Url: "not-valid-base64!!!", ivBase64Url: "also-not-valid!!!" });
    expect(result.ok).toBe(false);
  });

  it("fails gracefully on an empty ciphertext", async () => {
    const { keyBase64Url, ivBase64Url } = await encryptSceneDocument(fixtureDocument());
    const result = await decryptSceneCiphertext(new Uint8Array(), { keyBase64Url, ivBase64Url });
    expect(result.ok).toBe(false);
  });
});
