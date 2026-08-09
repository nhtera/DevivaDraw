/**
 * The one thing inline `style` objects can't express: pseudo-class states (`:hover`, `:focus-visible`,
 * `:active`), keyframes, and `@media (prefers-reduced-motion)`. Rather than add a CSS-in-JS dependency
 * or a build-time `.css` import (which the `tsc`-based library build wouldn't bundle), this injects one
 * small `<style>` element at runtime, scoped under the app root so it never leaks into a host page.
 *
 * All motion (transitions, press-scale, overlay pop-in) lives inside `@media (prefers-reduced-motion:
 * no-preference)`, so a user who prefers reduced motion gets the fully static chrome by construction —
 * no separate "reduce" override needed. Active button backgrounds key on `[aria-pressed="true"]`, which
 * every toggle button in the chrome sets (see `chrome-styles.ts`'s `buttonStyle` doc).
 */
const STYLE_ELEMENT_ID = "deviva-draw-chrome-stylesheet";

const ROOT = '[data-testid="deviva-draw-root"]';

const CHROME_CSS = `
${ROOT} button { background: transparent; }
${ROOT} button:hover:not(:disabled) { background: rgba(127, 127, 127, 0.14); }
${ROOT} button[aria-pressed="true"] { background: var(--dd-accent-soft); }
${ROOT} button[aria-pressed="true"]:hover:not(:disabled) { background: var(--dd-accent-soft); }
${ROOT} :focus-visible { outline: 2px solid var(--dd-accent); outline-offset: 1px; border-radius: 5px; }
${ROOT} [data-testid="text-editor-overlay-textarea"] { outline: none; }
/* The editor textarea is transparent (the canvas paints the glyphs), so its ::selection is the only
   thing that shows a text selection — e.g. the select-all on double-click-to-edit, matching how
   Excalidraw/tldraw show the highlighted text. A semi-transparent tint sits over the canvas glyphs
   (they read through it) and hugs exactly the selected characters, so it's a normal text highlight,
   not the opaque background box the old always-on backing used to draw. */
${ROOT} [data-testid="text-editor-overlay-textarea"]::selection { background: rgba(51, 103, 214, 0.30); }
@keyframes dd-pop-in { from { opacity: 0; transform: scale(0.97) translateY(-3px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: no-preference) {
  ${ROOT} button { transition: background 120ms ease, color 120ms ease, transform 90ms ease; }
  ${ROOT} button:active:not(:disabled) { transform: scale(0.95); }
  ${ROOT} .dd-animate-in { animation: dd-pop-in 140ms cubic-bezier(0.16, 1, 0.3, 1); }
}
`;

/** Injects the chrome stylesheet once per document (idempotent by element id). No-op outside a browser. */
export function ensureChromeStylesheet(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = CHROME_CSS;
  document.head.appendChild(style);
}
