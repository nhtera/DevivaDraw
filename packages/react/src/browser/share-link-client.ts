/**
 * The network leg between `@deviva-draw/engine`'s pure crypto (`encryptSceneDocument`/
 * `decryptSceneCiphertext`) and the collab-server's dumb ciphertext store — every actual encryption/
 * compression/JSON decision lives in the engine; this module only knows how to PUT/GET bytes over
 * `fetch`. Despite living under `browser/` alongside the other DOM-only adapters, this file uses only
 * `fetch`/`crypto` (both available in Node 22+ too, not DOM-specific), so it stays unit-testable with a
 * stubbed global `fetch` instead of needing a real browser.
 */
import { buildShareUrl, bytesToBase64Url, decryptSceneCiphertext, encryptSceneDocument, MULTI_PAGE_DOCUMENT_TYPE } from "@deviva-draw/engine";
import type { DecryptSceneErrorReason, MultiPageDocumentV1, SceneDocumentV1 } from "@deviva-draw/engine";
import type { ShareLinkResult } from "../actions/action-types";

function blobUrl(apiBaseUrl: string, blobId: string): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}/blobs/${encodeURIComponent(blobId)}`;
}

/**
 * Mints the revocation capability: a random 32-byte token the server never sees raw — only its
 * SHA-256 rides the upload (as a header), so revoking later requires presenting the original token,
 * which lives exclusively in this browser's share-link history. Same zero-knowledge posture as the
 * encryption key, one tier down: the token grants deletion, never decryption.
 */
async function mintDeleteToken(): Promise<{ token: string; tokenHashBase64Url: string }> {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", tokenBytes));
  return { token: bytesToBase64Url(tokenBytes), tokenHashBase64Url: bytesToBase64Url(hash) };
}

export interface CreateShareLinkOptions {
  /** The collab-server's base URL (e.g. `http://localhost:8788` in dev, the deployed Worker's URL in production). */
  apiBaseUrl: string;
  /** The app's own origin (`window.location.origin`) — becomes the share URL's `{origin}` (see `buildShareUrl`); injected rather than read internally so this stays testable without `window`. */
  origin: string;
  document: SceneDocumentV1 | MultiPageDocumentV1;
  /** ISO-8601 expiry rider — sent as a header for the server to validate/enforce; omitted = never expires. */
  expiresAt?: string;
}

/**
 * Encrypts `document` client-side, uploads only the ciphertext to the collab-server under a fresh
 * random blob id (tagged with a delete-token hash so the link is revocable from this browser), and
 * returns the shareable URL plus the revocation credentials. Throws (rather than returning a result
 * type) on any failure — network error, non-2xx response, or `encryptSceneDocument`'s own size-guard
 * error — since `actions/share-actions.ts` already wraps this call in its own try/catch to populate
 * `ShareDialogState`; a second result-type layer here would just be redundant error-handling.
 */
export async function createShareLink(options: CreateShareLinkOptions): Promise<ShareLinkResult> {
  const { apiBaseUrl, origin, document, expiresAt } = options;
  const { ciphertext, ivBase64Url, keyBase64Url } = await encryptSceneDocument(document);
  const blobId = crypto.randomUUID();
  const { token, tokenHashBase64Url } = await mintDeleteToken();

  const response = await fetch(blobUrl(apiBaseUrl, blobId), {
    method: "PUT",
    headers: {
      "content-type": "application/octet-stream",
      "x-deviva-delete-token-hash": tokenHashBase64Url,
      ...(expiresAt !== undefined ? { "x-deviva-expires-at": expiresAt } : {}),
    },
    // `BodyInit` requires an `ArrayBuffer`-backed view; `encryptSceneDocument`'s `ciphertext` is
    // always exactly that (it comes from `SubtleCrypto.encrypt`'s output), but `Uint8Array`'s type is
    // generic over the wider `ArrayBufferLike` — see `@deviva-draw/engine`'s `gzip-codec.ts` for the
    // same cast pattern.
    body: ciphertext as Uint8Array<ArrayBuffer>,
  });
  if (!response.ok) throw new Error(`share-link-client: upload failed with status ${response.status}`);

  return {
    url: buildShareUrl({ origin, blobId, keyBase64Url, ivBase64Url }),
    blobId,
    deleteToken: token,
    pageCount: document.type === MULTI_PAGE_DOCUMENT_TYPE ? document.pages.length : 1,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

/** Machine-checkable revoke failure — "not-revocable" maps the server's 403 (wrong token, or a legacy blob that never stored a hash). */
export type RevokeShareLinkErrorReason = "not-revocable" | "network-error" | "http-error";

export type RevokeShareLinkResult = { ok: true } | { ok: false; reason: RevokeShareLinkErrorReason };

/**
 * Revokes a share link by presenting the raw delete token minted at creation. A 404 counts as
 * success — the promise to the sharer is "this link is dead", and an already-gone blob fulfils it —
 * while a 403 must NOT (the blob is still live and fetchable; reporting success would be the exact
 * lie revocation exists to prevent).
 */
export async function revokeShareLink(options: { apiBaseUrl: string; blobId: string; deleteToken: string }): Promise<RevokeShareLinkResult> {
  const { apiBaseUrl, blobId, deleteToken } = options;
  let response: Response;
  try {
    response = await fetch(blobUrl(apiBaseUrl, blobId), { method: "DELETE", headers: { "x-deviva-delete-token": deleteToken } });
  } catch {
    return { ok: false, reason: "network-error" };
  }
  if (response.status === 204 || response.status === 404) return { ok: true };
  if (response.status === 403) return { ok: false, reason: "not-revocable" };
  return { ok: false, reason: "http-error" };
}

/** Machine-checkable failure reason for `fetchAndDecryptSharedScene` — mirrors `DecryptSceneErrorReason`'s "code, not prose" contract so callers (the shared-scene viewer) pick an i18n'd message rather than parsing free text. */
export type FetchSharedSceneErrorReason = "not-found" | "network-error" | "http-error" | DecryptSceneErrorReason;

export interface FetchSharedSceneOptions {
  apiBaseUrl: string;
  blobId: string;
  keyBase64Url: string;
  ivBase64Url: string;
}

export type FetchSharedSceneResult = { ok: true; value: unknown } | { ok: false; reason: FetchSharedSceneErrorReason };

/** Fetches ciphertext for `blobId` from the collab-server and decrypts it with the given key/IV — the read-side counterpart to `createShareLink`. Never throws. */
export async function fetchAndDecryptSharedScene(options: FetchSharedSceneOptions): Promise<FetchSharedSceneResult> {
  const { apiBaseUrl, blobId, keyBase64Url, ivBase64Url } = options;

  let response: Response;
  try {
    response = await fetch(blobUrl(apiBaseUrl, blobId));
  } catch {
    return { ok: false, reason: "network-error" };
  }
  if (response.status === 404) return { ok: false, reason: "not-found" };
  if (!response.ok) return { ok: false, reason: "http-error" };

  const ciphertext = new Uint8Array(await response.arrayBuffer());
  const decrypted = await decryptSceneCiphertext(ciphertext, { keyBase64Url, ivBase64Url });
  if (!decrypted.ok) return { ok: false, reason: decrypted.reason };
  return { ok: true, value: decrypted.value };
}
