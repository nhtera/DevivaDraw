/**
 * Embed provider allowlist + URL→embed-URL transforms. Only content from a known, sandboxable set of
 * providers is embeddable — arbitrary iframes are a click-jacking / drive-by surface, so an unknown
 * host returns `null` (the caller refuses the embed) rather than framing whatever URL it was handed.
 * Each provider maps a normal share/watch URL to its dedicated embeddable URL. Pure + dependency-free
 * so it's fully unit-testable and identical on server or client.
 */
export interface EmbedResolution {
  provider: string;
  embedUrl: string;
  /**
   * A static poster image for the content, when the provider exposes a stable thumbnail URL. The host
   * app shows this by default and only mounts the live `<iframe>` when the user activates the embed —
   * so a board with many embeds doesn't run many live iframes, and there's no cross-origin frame under
   * the cursor to steal a drag/resize. Absent (e.g. Figma/CodeSandbox) → the canvas placeholder shows.
   */
  previewUrl?: string;
}

/** Parses `raw` into a URL only if it's http/https (a bare host is upgraded to https). */
function parseHttpUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Resolves `raw` to a sandboxable embed URL for an allowlisted provider, or `null` if not embeddable. */
export function resolveEmbed(raw: string): EmbedResolution | null {
  const url = parseHttpUrl(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase();

  // YouTube — watch?v=ID, youtu.be/ID, or an /embed/ URL.
  if (hostMatches(host, "youtube.com") || host === "youtu.be") {
    const id = host === "youtu.be" ? url.pathname.slice(1) : url.pathname.startsWith("/embed/") ? url.pathname.split("/")[2] : url.searchParams.get("v");
    return id ? { provider: "youtube", embedUrl: `https://www.youtube.com/embed/${id}`, previewUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } : null;
  }

  // Vimeo — vimeo.com/ID.
  if (hostMatches(host, "vimeo.com")) {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && /^\d+$/.test(id) ? { provider: "vimeo", embedUrl: `https://player.vimeo.com/video/${id}` } : null;
  }

  // Figma — embed via its official embed host, passing the file URL through.
  if (hostMatches(host, "figma.com")) {
    return { provider: "figma", embedUrl: `https://www.figma.com/embed?embed_host=deviva&url=${encodeURIComponent(url.toString())}` };
  }

  // CodeSandbox — /s/ID or /embed/ID.
  if (hostMatches(host, "codesandbox.io")) {
    const parts = url.pathname.split("/").filter(Boolean);
    const id = parts[0] === "embed" || parts[0] === "s" ? parts[1] : parts[0];
    return id ? { provider: "codesandbox", embedUrl: `https://codesandbox.io/embed/${id}` } : null;
  }

  return null; // not on the allowlist — refuse rather than frame an arbitrary site
}

/** Whether `raw` is embeddable at all (a cheap guard for UI enable/disable). */
export function isEmbeddable(raw: string): boolean {
  return resolveEmbed(raw) !== null;
}
