/**
 * The inverse of `build-share-url.ts`: pulls `{blobId, keyBase64Url, ivBase64Url}` back out of a
 * `/s/{blobId}` pathname + `#key=...&iv=...` fragment. Accepts the pathname and fragment as separate
 * plain strings (rather than parsing a full URL) so a caller already holding
 * `window.location.pathname`/`window.location.hash` doesn't need to reconstruct a URL object, and so
 * this stays trivially unit-testable. Never throws: this is the one place a URL an attacker fully
 * controls — a share link they crafted or tampered with before forwarding it — gets parsed, so every
 * malformed shape returns a descriptive `{ ok: false }` result instead of an exception reaching the
 * caller.
 */
export type ParseShareUrlErrorReason = "invalid-path" | "missing-blob-id" | "missing-key-material";

export interface ParsedShareUrl {
  blobId: string;
  keyBase64Url: string;
  ivBase64Url: string;
}

export type ParseShareUrlResult = { ok: true; value: ParsedShareUrl } | { ok: false; reason: ParseShareUrlErrorReason; error: string };

const SHARE_PATH_PATTERN = /^\/s\/([^/]+)\/?$/;

export function parseShareUrl(pathname: string, fragment: string): ParseShareUrlResult {
  const pathMatch = SHARE_PATH_PATTERN.exec(pathname);
  if (!pathMatch) return { ok: false, reason: "invalid-path", error: 'share URL path must be "/s/{blobId}"' };

  const rawBlobId = pathMatch[1];
  if (!rawBlobId) return { ok: false, reason: "missing-blob-id", error: "share URL is missing a blob id" };
  const blobId = decodeURIComponent(rawBlobId);

  const normalizedFragment = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const params = new URLSearchParams(normalizedFragment);
  const keyBase64Url = params.get("key");
  const ivBase64Url = params.get("iv");
  if (!keyBase64Url || !ivBase64Url) {
    return { ok: false, reason: "missing-key-material", error: "share URL fragment is missing the decryption key or IV" };
  }

  return { ok: true, value: { blobId, keyBase64Url, ivBase64Url } };
}
