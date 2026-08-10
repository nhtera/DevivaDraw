/**
 * URL normalization + safety gate for element hyperlinks (see `link-section.tsx`). A bare host like
 * `example.com` is upgraded to `https://`; only `http:`/`https:` URLs are accepted — a `javascript:`
 * or `data:` scheme (an XSS vector if later opened via `window.open`/an anchor) returns `null`.
 */
export function normalizeLinkUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
