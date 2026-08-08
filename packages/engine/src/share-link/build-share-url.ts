/**
 * Constructs the shareable URL for an uploaded blob: `{origin}/s/{blobId}#key={keyBase64Url}&iv=
 * {ivBase64Url}`. `origin` is the deployed app's own origin (e.g. `https://draw.deviva.app`) — this
 * module never hardcodes it, so it stays a pure, environment-agnostic, unit-testable string builder;
 * callers (the browser-facing share-link client) inject `window.location.origin`. The key and IV live
 * in the URL fragment (`#`), which browsers never send to any server on navigation or a `fetch` to a
 * different path — that omission is the entire E2E trust boundary this feature rests on; nothing here
 * — or anywhere downstream — must ever move them into the path or query string.
 */
export interface BuildShareUrlOptions {
  origin: string;
  blobId: string;
  keyBase64Url: string;
  ivBase64Url: string;
}

export function buildShareUrl(options: BuildShareUrlOptions): string {
  const { origin, blobId, keyBase64Url, ivBase64Url } = options;
  const normalizedOrigin = origin.replace(/\/+$/, "");
  return `${normalizedOrigin}/s/${encodeURIComponent(blobId)}#key=${keyBase64Url}&iv=${ivBase64Url}`;
}
