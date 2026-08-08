/**
 * Pure helpers for classifying pasted/dropped content as an image insert — split out from
 * `use-paste-and-drop.ts` so the actual selection/sniffing logic is unit-testable without a real
 * `ClipboardEvent`/`DataTransfer` (this package's vitest environment has no `jsdom`, the same split
 * `should-commit-on-enter.ts` uses for `use-text-editing.ts`'s DOM-bound handler).
 *
 * Security: SVG paste is only ever ferried through here as plain text, then handed to
 * `insertImageFile` (which rasterizes it through a data-URL `Image()` decode) — this module never
 * touches the DOM, so it cannot itself be an SVG-script-injection vector. See `use-paste-and-drop.ts`'s
 * doc for the full security note.
 */

/** True for any MIME type treated as a rasterizable image (`image/*`, including `image/svg+xml`). */
export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

// Loose sniff for "this pasted plain text is SVG markup, not prose" — a `<svg` tag anywhere (optionally
// preceded by an XML/doctype prolog) is a good-enough signal for a paste handler; false positives
// (someone literally pasting the text "<svg>") are harmless since it just gets wrapped as a
// (probably blank) image instead of being treated as prose.
const SVG_MARKUP_PATTERN = /<svg[\s>]/i;

export function looksLikeSvgMarkup(text: string): boolean {
  return SVG_MARKUP_PATTERN.test(text);
}

export const SVG_MIME_TYPE = "image/svg+xml";

/** Encodes SVG markup as UTF-8 bytes for `insertImageFile` — SVG paste is always rasterized through that data-URL path, never injected as live DOM (script execution risk); see the module doc. */
export function svgMarkupToBytes(svg: string): Uint8Array {
  return new TextEncoder().encode(svg);
}

/** Minimal shape of a `File`/`DataTransferItem` this module needs to classify — a plain object satisfies it in tests, a real DOM `File` satisfies it in the browser. */
export interface MimeTyped {
  type: string;
}

/** First item in `items` whose MIME type is a rasterizable image, or `undefined` if none qualify. */
export function findFirstImageItem<T extends MimeTyped>(items: readonly T[]): T | undefined {
  return items.find((item) => isImageMimeType(item.type));
}

/**
 * Coarse, synchronously-knowable classification of what a clipboard payload *might* contain —
 * computed from each item's declared `kind`/`type` alone, before any async content is read. `"file"`
 * covers an actual image file (a copied screenshot, a dragged-in image, ...); `"svg-mime"` covers a
 * clipboard item explicitly flavored `image/svg+xml` by the source app; `"text-plain"` covers a
 * generic text item that *might* be SVG markup, but whose content hasn't been sniffed yet.
 */
export type ClipboardItemKind = "file" | "svg-mime" | "text-plain";

/**
 * Whether a paste event should be treated as a candidate image insert at all — decided purely from
 * the paste target and the clipboard's declared item kinds, before any async item content is read.
 * `false` means: do nothing, let the browser's native paste (typing into the focused field) proceed
 * untouched.
 *
 * This is the fix for a real race: `DataTransferItem.getAsString` (needed to sniff whether a
 * `text/plain` item is actually SVG markup) is asynchronous, so by the time that callback fires the
 * synchronous native paste has already happened — calling `preventDefault()` from inside it is too
 * late. Gating on this predicate *before* any async work starts, and calling `preventDefault()`
 * synchronously right when it returns `true`, closes that race instead of trying to win it: while the
 * paste target is editable (a real `<input>`/`<textarea>`/`contenteditable` — the in-canvas text
 * editor overlay is a `<textarea>`), the answer is always `false` and no clipboard processing happens
 * at all, so there is nothing left to race.
 *
 * Outside an editable target, an image file or an explicitly `image/svg+xml`-flavored item is always
 * eligible (both are unambiguous, no content sniffing required); a generic `text/plain` item is only
 * eligible because sniffing it is now safe — the canvas/window has no native paste behavior to race
 * against.
 */
export function shouldConsumePaste(activeElementTag: string | null, isContentEditable: boolean, itemKinds: readonly ClipboardItemKind[]): boolean {
  const isEditableTarget = isContentEditable || activeElementTag === "INPUT" || activeElementTag === "TEXTAREA";
  if (isEditableTarget) return false;
  return itemKinds.length > 0;
}
