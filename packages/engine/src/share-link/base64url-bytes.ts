/**
 * Base64url (RFC 4648 §5) <-> raw bytes. Used for the AES-GCM key and IV that travel in a share
 * link's URL fragment (`build-share-url.ts`/`parse-share-url.ts`): base64url has no `+`, `/`, or `=`
 * characters, so it sits safely inside a URL fragment with zero percent-encoding. `btoa`/`atob` operate
 * on binary (Latin1) strings, not bytes directly, so both directions go through an explicit byte<->
 * char-code loop rather than relying on any Node-only `Buffer` API — this module must stay usable
 * unmodified in a browser, where `Buffer` does not exist.
 */

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/**
 * Reverses `bytesToBase64Url`. Throws (a plain `Error`, not a custom type — see `decrypt-scene.ts`
 * and `parse-share-url.ts` for how callers that receive attacker-controlled fragments turn this into a
 * graceful `{ ok: false }` result rather than letting it propagate) when `base64Url` contains a
 * character outside the base64url alphabet.
 */
export function base64UrlToBytes(base64Url: string): Uint8Array {
  const base64 = base64Url.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
