/**
 * Reverses `encrypt-scene.ts`: given ciphertext bytes + the key/IV that traveled in the URL fragment,
 * decrypt, decompress, and JSON-parse back to a plain value. Deliberately stops at `JSON.parse` and
 * returns `unknown` rather than a typed `SceneDocumentV1` — this is untrusted input from a URL an
 * attacker could have crafted (wrong key, corrupted blob, or a link forwarded by someone else
 * entirely), so the caller must still run the result through `persistence/serialize-scene.ts`'s
 * `deserializeScene` (the one place untrusted scene JSON is allowed to become a live `Scene`) rather
 * than trusting this module's output as already-valid.
 */
import { base64UrlToBytes } from "./base64url-bytes";
import { gzipDecompress } from "./gzip-codec";

/**
 * Machine-checkable failure reason, distinct from `error` (a human-readable detail meant for logs, not
 * necessarily end-user copy) — callers building UI (e.g. `packages/react`'s shared-scene viewer) branch
 * on `reason` to pick an i18n'd message rather than parsing `error`'s free text.
 */
export type DecryptSceneErrorReason = "decrypt-failed" | "decompress-failed" | "invalid-json";

export interface DecryptSceneKeyMaterial {
  keyBase64Url: string;
  ivBase64Url: string;
}

export type DecryptSceneResult = { ok: true; value: unknown } | { ok: false; reason: DecryptSceneErrorReason; error: string };

/**
 * `ciphertext` + `keyMaterial` -> the decompressed, JSON-parsed payload, or a descriptive failure —
 * never throws. A wrong key, a tampered ciphertext (AES-GCM's built-in authentication tag rejects any
 * bit-flip), or garbage in the key/IV fragment all surface as `reason: "decrypt-failed"` from
 * `SubtleCrypto.decrypt`'s `OperationError`; a successfully-decrypted-but-not-actually-gzip payload
 * surfaces as `"decompress-failed"`; valid bytes that still aren't JSON surface as `"invalid-json"`.
 */
export async function decryptSceneCiphertext(ciphertext: Uint8Array, keyMaterial: DecryptSceneKeyMaterial): Promise<DecryptSceneResult> {
  let compressed: Uint8Array;
  try {
    const rawKey = base64UrlToBytes(keyMaterial.keyBase64Url);
    const iv = base64UrlToBytes(keyMaterial.ivBase64Url);
    // See `gzip-codec.ts`'s cast-pattern comment: `rawKey`/`ciphertext` are always `ArrayBuffer`-backed
    // in every caller of this module, but `Uint8Array`'s type can't statically prove that.
    const key = await crypto.subtle.importKey("raw", rawKey as Uint8Array<ArrayBuffer>, "AES-GCM", false, ["decrypt"]);
    const decryptedBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as Uint8Array<ArrayBuffer> }, key, ciphertext as Uint8Array<ArrayBuffer>);
    compressed = new Uint8Array(decryptedBuffer);
  } catch (error) {
    return { ok: false, reason: "decrypt-failed", error: error instanceof Error ? error.message : "decryption failed" };
  }

  let jsonText: string;
  try {
    jsonText = new TextDecoder().decode(await gzipDecompress(compressed));
  } catch (error) {
    return { ok: false, reason: "decompress-failed", error: error instanceof Error ? error.message : "decompression failed" };
  }

  try {
    return { ok: true, value: JSON.parse(jsonText) };
  } catch (error) {
    return { ok: false, reason: "invalid-json", error: error instanceof Error ? error.message : "invalid JSON" };
  }
}
