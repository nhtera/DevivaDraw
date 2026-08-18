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
import { chromeFontFamily, RADIUS } from "./chrome-styles";

const STYLE_ELEMENT_ID = "deviva-draw-chrome-stylesheet";

const ROOT = '[data-testid="deviva-draw-root"]';

const CHROME_CSS = `
/* The chrome's font stack, declared once on the root so every descendant inherits it — including the
   bare elements that set no font of their own. A host page need not ship any global font rule (the web
   app ships none), so anything left inheriting from the document fell back to the browser's default
   serif: the zen-mode and back-to-content pills (buttons that *are* the panel, whose inherited
   font-family reached past the chrome to the page) and every unstyled control, such as the
   comment pin's reply count. The second rule is the one browsers need explicitly: form controls do not
   inherit fonts, they take a UA font unless told otherwise. Family only — sizes stay per-component. */
${ROOT} { font-family: ${chromeFontFamily}; }
${ROOT} button, ${ROOT} input, ${ROOT} textarea, ${ROOT} select { font-family: inherit; }
/* Chrome labels are UI, not content: without this a canvas-wide select-all (Cmd+A, which selects every
   *element*) also drags the browser's own text selection across every panel label and menu item, leaving
   the whole UI highlighted blue until the next click. Inputs opt back in below — they are the only places
   in the chrome where selecting, and copying, real text is the point. */
${ROOT} { user-select: none; -webkit-user-select: none; }
/* Touch hardening: no rubber-band/pull-to-refresh behind the canvas, no grey tap flash on chrome,
   no double-tap-to-zoom delay on buttons (touch-action: manipulation), and no iOS long-press
   callout/share-sheet on the canvas host — the app's own long-press opens its context menu there. */
${ROOT} { overscroll-behavior: none; -webkit-tap-highlight-color: transparent; }
${ROOT} button, ${ROOT} a.dd-menu-link { touch-action: manipulation; }
${ROOT} [data-testid="deviva-draw-canvas-host"] { -webkit-touch-callout: none; }
${ROOT} input, ${ROOT} textarea, ${ROOT} [contenteditable="true"] { user-select: text; -webkit-user-select: text; }
${ROOT} button { background: transparent; }
${ROOT} button:hover:not(:disabled) { background: rgba(127, 127, 127, 0.14); }
/* External-link menu items are real <a> elements (middle-click, copy-link) but share the button hover. */
${ROOT} a.dd-menu-link { background: transparent; }
${ROOT} a.dd-menu-link:hover { background: rgba(127, 127, 127, 0.14); }
${ROOT} button[aria-pressed="true"] { background: var(--dd-accent-soft); }
${ROOT} button[aria-pressed="true"]:hover:not(:disabled) { background: var(--dd-accent-soft); }
${ROOT} :focus-visible { outline: 2px solid var(--dd-accent); outline-offset: 1px; border-radius: 5px; }
/* Checkboxes/radios follow the theme accent instead of the browser's own blue, which is the one bit of
   chrome that never matched the dark theme. */
${ROOT} input[type="checkbox"], ${ROOT} input[type="radio"] { accent-color: var(--dd-accent); }
/* Segmented control: a row of radio buttons that reads as one control (an inset track with the chosen
   option as a raised chip), for pick-one-of-a-few choices like the export scale. The chosen chip uses
   the same --dd-accent-soft tint as every other active button in the chrome, keyed on aria-checked —
   the radio-role counterpart of the aria-pressed rules above, which a radiogroup must not use. */
${ROOT} .dd-segmented { display: flex; gap: 2px; padding: 2px; border-radius: ${RADIUS.control + 2}px; background: rgba(127, 127, 127, 0.10); }
${ROOT} .dd-segmented > button { flex: 1; }
${ROOT} .dd-segmented > button[aria-checked="true"],
${ROOT} .dd-segmented > button[aria-checked="true"]:hover:not(:disabled) { background: var(--dd-accent-soft); }
/* Checkbox rows in dialogs: the whole row is the hit target (the <label> wraps the box and its text),
   so it needs the row-wide hover a bare label has no way to show. */
${ROOT} .dd-check-row { border-radius: ${RADIUS.control}px; }
${ROOT} .dd-check-row:not([data-disabled="true"]):hover { background: rgba(127, 127, 127, 0.10); }
${ROOT} [data-testid="text-editor-overlay-textarea"] { outline: none; }
/* The editor textarea is transparent (the canvas paints the glyphs), so its ::selection is the only
   thing that shows a text selection — e.g. the select-all on double-click-to-edit, matching how
   Excalidraw/tldraw show the highlighted text. A semi-transparent tint sits over the canvas glyphs
   (they read through it) and hugs exactly the selected characters, so it's a normal text highlight,
   not the opaque background box the old always-on backing used to draw. */
${ROOT} [data-testid="text-editor-overlay-textarea"]::selection { background: rgba(51, 103, 214, 0.30); }
/* Scrollbars inside the chrome (properties panel, menus, dialogs, library, palette): a thin floating
   pill on a transparent track instead of the browser's full-width gutter — the panel's content keeps
   the space, and the bar reads as an affordance rather than furniture. The transparent border +
   content-box clip is what insets the pill from the panel edge; background-color (never the
   background shorthand) so the hover rule can't silently reset that clip. One neutral grey with
   alpha stays legible over both the light and dark chrome without theme-specific rules. */
${ROOT} ::-webkit-scrollbar { width: 10px; height: 10px; }
${ROOT} ::-webkit-scrollbar-track { background: transparent; }
${ROOT} ::-webkit-scrollbar-corner { background: transparent; }
${ROOT} ::-webkit-scrollbar-thumb {
  background-color: rgba(127, 127, 127, 0.35);
  background-clip: content-box;
  border: 3px solid transparent;
  border-radius: 999px;
  min-height: 40px;
}
${ROOT} ::-webkit-scrollbar-thumb:hover { background-color: rgba(127, 127, 127, 0.55); }
/* Firefox has no scrollbar pseudo-elements — thin + colored is the closest expression of the same look. */
${ROOT}, ${ROOT} * { scrollbar-width: thin; scrollbar-color: rgba(127, 127, 127, 0.45) transparent; }

/* Library tiles: the preview reads only when the grid isn't a field of × buttons, so the remove control
   is revealed on hover — and on keyboard focus, so it stays reachable without a pointer. Gated on
   "hover: hover": a touch device has no hover state, so hiding it there would make removal impossible,
   and those devices keep the control permanently visible instead. */
@media (hover: hover) {
  ${ROOT} .dd-library-tile__remove { opacity: 0; pointer-events: none; }
  ${ROOT} .dd-library-tile:hover .dd-library-tile__remove,
  ${ROOT} .dd-library-tile:focus-within .dd-library-tile__remove { opacity: 1; pointer-events: auto; }
  ${ROOT} .dd-library-tile:hover button[data-testid="library-item"] { border-color: var(--dd-chrome-border); background: rgba(127, 127, 127, 0.10); }
}
/* Tablet tier ("touch" density — set by the shell when the viewport is desktop-sized but the primary
   pointer is coarse, e.g. an iPad in landscape): desktop layout with >=44px effective touch targets,
   scoped to canvas-adjacent chrome only — toolbar, top bar, zoom/main/context/more-tools menus and
   the mobile bars. Dialogs and side panels deliberately keep desktop sizing (their buttonStyle() is
   shared by 26 files; a global bump would silently resize unaudited surfaces). Icon-button surfaces
   get a real visual bump; full-width menu rows grow height only; the dense properties panel keeps
   its compact visuals and expands the effective hit area with a pseudo-element instead. */
${ROOT}[data-dd-density="touch"] [role="toolbar"] button,
${ROOT}[data-dd-density="touch"] [data-testid="top-bar"] button,
${ROOT}[data-dd-density="touch"] [data-testid="tablet-bottom-controls"] button,
${ROOT}[data-dd-density="touch"] [data-testid="more-tools-popover"] button,
${ROOT}[data-dd-density="touch"] [data-testid="zoom-menu-popover"] button { min-width: 44px; min-height: 44px; }
${ROOT}[data-dd-density="touch"] [data-testid="main-menu"] button,
${ROOT}[data-dd-density="touch"] [data-testid="main-menu"] a.dd-menu-link,
${ROOT}[data-dd-density="touch"] [data-testid="main-menu-preferences-flyout"] button,
${ROOT}[data-dd-density="touch"] [data-testid="context-menu"] button { min-height: 44px; }
${ROOT}[data-dd-density="touch"] [data-testid^="properties-panel"] button { position: relative; }
${ROOT}[data-dd-density="touch"] [data-testid^="properties-panel"] button::after { content: ""; position: absolute; inset: -7px; }
/* The 44px toolbar is taller, so the canvas hint below it needs a lower anchor (var read by canvas-hint.tsx). */
${ROOT}[data-dd-density="touch"] { --dd-hint-top: 80px; }
/* In the tablet tier the top bar is just the hamburger (history/zoom live bottom-left — see
   TabletBottomControls), so the centered toolbar owns the top row. max() still clamps its left edge
   past that small island on the narrowest tablets, and below the single-row breakpoint (portrait
   iPads) the toolbar drops to a second row with the canvas hint following. Vars are read by
   toolbar.tsx / canvas-hint.tsx. */
${ROOT}[data-dd-density="touch"] [data-testid="toolbar"] { --dd-toolbar-shift: translateX(max(-50%, calc(76px - 50vw))); }
@media (max-width: 853px) {
  ${ROOT}[data-dd-density="touch"] [data-testid="toolbar"] {
    --dd-toolbar-top: calc(74px + env(safe-area-inset-top));
    --dd-toolbar-shift: translateX(-50%);
  }
  ${ROOT}[data-dd-density="touch"] { --dd-hint-top: 140px; }
}

/* An edge-anchored sidebar slides in from its own edge. The shared .dd-animate-in pop-in scales the
   whole element, which on a full-height panel reads as the entire sidebar shrinking away from the
   screen edges rather than arriving. */
@keyframes dd-slide-in-right { from { transform: translateX(100%); } to { transform: none; } }
@keyframes dd-pop-in { from { opacity: 0; transform: scale(0.97) translateY(-3px); } to { opacity: 1; transform: none; } }
/* A presentation reaction drifts up from where its sender's cursor was and fades out. Defined outside
   the reduced-motion block because the element is REMOVED when the animation's lifetime elapses — with
   no animation at all it would sit fully opaque until then, so the reduced-motion variant below keeps
   the fade and drops only the travel. */
@keyframes dd-reaction-float { from { opacity: 0; transform: translate(-50%, 0) scale(0.7); } 15% { opacity: 1; transform: translate(-50%, -10px) scale(1); } to { opacity: 0; transform: translate(-50%, -90px) scale(1); } }
@keyframes dd-reaction-fade { from { opacity: 0; transform: translate(-50%, 0); } 15% { opacity: 1; } to { opacity: 0; transform: translate(-50%, 0); } }
${ROOT} .dd-reaction { animation: dd-reaction-fade var(--dd-reaction-lifetime, 2600ms) ease-out forwards; }
@media (prefers-reduced-motion: no-preference) {
  ${ROOT} .dd-reaction { animation-name: dd-reaction-float; }
  ${ROOT} button, ${ROOT} a.dd-menu-link { transition: background 120ms ease, color 120ms ease, transform 90ms ease; }
  ${ROOT} button:active:not(:disabled) { transform: scale(0.95); }
  ${ROOT} .dd-animate-in { animation: dd-pop-in 140ms cubic-bezier(0.16, 1, 0.3, 1); }
  ${ROOT} .dd-slide-in-right { animation: dd-slide-in-right 160ms cubic-bezier(0.16, 1, 0.3, 1); }
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
