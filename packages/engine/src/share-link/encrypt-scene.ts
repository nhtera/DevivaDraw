/**
 * Compress + AES-GCM encrypt a scene document for a shareable link. The server that eventually stores
 * the returned ciphertext (`apps/collab-server`'s `blob-routes.ts`) never sees the plaintext or the
 * key — `keyBase64Url` is only ever placed in a URL fragment (`build-share-url.ts`), which browsers
 * never transmit to any server. A fresh random key and IV are generated on every call: link A's key
 * must never help decrypt link B's ciphertext, even for the same scene shared twice.
 */
import type { MultiPageDocumentV1 } from "../persistence/multi-page-document";
import type { SceneDocumentV1 } from "../persistence/scene-schema";
import { bytesToBase64Url } from "./base64url-bytes";
import { gzipCompress } from "./gzip-codec";

const AES_KEY_LENGTH_BITS = 256;
/** NIST SP 800-38D's recommended IV length for AES-GCM — using any other length is a footgun (shorter IVs are internally padded in a way that weakens the authentication guarantee), so this is not made configurable. */
const GCM_IV_LENGTH_BYTES = 12;

/**
 * Conservative cap on the *encrypted* payload size, mirroring `images/insert-image-file.ts`'s
 * `DEFAULT_MAX_FILE_SIZE_BYTES` size-guard pattern for a single pasted image. A scene can embed several
 * images, so this cap is higher than that single-file limit; it exists purely as an abuse/cost guard
 * (unbounded R2 storage growth from oversized uploads), not a correctness boundary — the
 * collab-server's own `MAX_BLOB_BYTES` enforces the same limit again server-side, since a client-side
 * check alone is trivially bypassed by anyone calling the upload endpoint directly.
 */
export const MAX_SHARE_PAYLOAD_BYTES = 15 * 1024 * 1024;

/** Thrown when the compressed+encrypted payload exceeds `maxPayloadBytes` — thrown before any network call, so a rejected share never wastes an upload attempt. */
export class ShareScenePayloadTooLargeError extends Error {
  constructor(
    readonly sizeBytes: number,
    readonly maxSizeBytes: number,
  ) {
    super(`encrypt-scene: encrypted payload is ${sizeBytes} bytes, exceeds the ${maxSizeBytes} byte share-link limit`);
    this.name = "ShareScenePayloadTooLargeError";
  }
}

export interface EncryptSceneOptions {
  /** Overrides `MAX_SHARE_PAYLOAD_BYTES` — primarily for tests that want to exercise the size guard without constructing a multi-megabyte scene. */
  maxPayloadBytes?: number;
}

export interface EncryptedSharePayload {
  /** AES-GCM ciphertext bytes (the authentication tag is appended by `SubtleCrypto.encrypt` itself, per the Web Crypto spec — no separate tag field). */
  ciphertext: Uint8Array;
  /** Base64url-encoded random IV used for this encryption — must accompany the ciphertext to decrypt (travels in the URL fragment, see `build-share-url.ts`, never in the ciphertext blob itself). */
  ivBase64Url: string;
  /** Base64url-encoded raw AES-GCM key — never sent to the server; only ever placed in the URL fragment. */
  keyBase64Url: string;
}

/**
 * `SceneDocumentV1` -> gzip-compressed, AES-GCM-encrypted bytes + the fresh key/IV needed to reverse
 * it (see `decrypt-scene.ts`). Compression happens on the plaintext JSON, before encryption — see
 * `gzip-codec.ts`'s module doc for why the order matters.
 */
export async function encryptSceneDocument(document: SceneDocumentV1 | MultiPageDocumentV1, options: EncryptSceneOptions = {}): Promise<EncryptedSharePayload> {
  const maxPayloadBytes = options.maxPayloadBytes ?? MAX_SHARE_PAYLOAD_BYTES;

  const json = JSON.stringify(document);
  const compressed = await gzipCompress(new TextEncoder().encode(json));

  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: AES_KEY_LENGTH_BITS }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_LENGTH_BYTES));
  // `compressed` is always `ArrayBuffer`-backed (produced by `gzip-codec.ts`'s `Response.arrayBuffer()`
  // round trip) — see that module's cast-pattern comment for why `BufferSource` still needs an
  // explicit assertion here.
  const ciphertextBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, compressed as Uint8Array<ArrayBuffer>);
  const ciphertext = new Uint8Array(ciphertextBuffer);

  if (ciphertext.byteLength > maxPayloadBytes) throw new ShareScenePayloadTooLargeError(ciphertext.byteLength, maxPayloadBytes);

  const rawKey = await crypto.subtle.exportKey("raw", key);
  return { ciphertext, ivBase64Url: bytesToBase64Url(iv), keyBase64Url: bytesToBase64Url(new Uint8Array(rawKey)) };
}
