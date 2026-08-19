/**
 * Font-family CSS stacks + a `fontsReady` gate for text measurement/render.
 *
 * `"normal"`/`"code"` resolve to OS-provided font stacks. The `"hand-drawn-slot"` family — the default
 * text face, a hand-drawn font paired with the sketchy rough.js shape rendering so text and shapes read
 * as one hand — is the bundled Patrick Hand (SIL OFL), embedded as a self-contained base64 `woff2` data
 * URI (`hand-drawn-font-data.ts`) so it ships with the package and needs no external host.
 * `loadTextFonts` registers every `FontFace` in `sources` (defaulting to that bundled font) via the
 * injected `target.fonts`, then awaits `target.fonts.ready`. The subset covers Latin-1, Latin
 * Extended-A/B and the full Vietnamese precomposed block (see `hand-drawn-font-data.ts` for the exact
 * ranges); anything outside them falls back to the sans stack listed after the custom family in
 * `TEXT_FONT_FAMILY_CSS`.
 */
import type { TextFontFamily } from "../elements/text-element";
import { HAND_DRAWN_FONT_DATA_URL, HAND_DRAWN_FONT_FAMILY } from "./hand-drawn-font-data";

/** CSS `font-family` stack for each `TextFontFamily` slot; `"hand-drawn-slot"` leads with the bundled hand-drawn face, then the same sans stack as `"normal"` for any glyph outside its subset. */
export const TEXT_FONT_FAMILY_CSS: Record<TextFontFamily, string> = {
  normal: '"Helvetica Neue", Arial, "Segoe UI", sans-serif',
  code: '"Cascadia Code", "Fira Code", Menlo, Consolas, monospace',
  "hand-drawn-slot": `"${HAND_DRAWN_FONT_FAMILY}", "Helvetica Neue", Arial, "Segoe UI", sans-serif`,
};

/** Named UI size levels -> pixel `fontSize`, matching `tools/shape-style-state.ts`'s `STROKE_WIDTH_LEVELS`/`SLOPPINESS_LEVELS` pattern. */
export const FONT_SIZE_LEVELS = { S: 16, M: 20, L: 28, XL: 36 } as const;

/** A webfont to register before the readiness gate resolves. */
export interface TextFontFaceSource {
  family: string;
  url: string;
  descriptors?: FontFaceDescriptors;
}

/** The fonts this build ships and registers by default — currently just the bundled hand-drawn face. `loadTextFonts` uses this when no explicit `sources` are given. */
export const DEFAULT_TEXT_FONT_SOURCES: readonly TextFontFaceSource[] = [
  { family: HAND_DRAWN_FONT_FAMILY, url: HAND_DRAWN_FONT_DATA_URL },
];

/** The `document`-shaped surface this needs — narrow and injectable so tests never require a real DOM `document`. */
export interface FontLoaderTarget {
  fonts: {
    add(face: FontFace): void;
    ready: Promise<unknown>;
  };
}

/**
 * Resolves once every font family this build ships is safe to measure/render against. Registers
 * each of `sources` (defaults to none — see module doc) as a `FontFace` on `target.fonts` before
 * awaiting `target.fonts.ready`; a registration failure is left for `FontFaceSet.ready` itself to
 * reflect (the spec settles `ready` once every pending face has either loaded or failed) rather than
 * swallowed here, so a broken font URL surfaces as a rejected/settled state instead of vanishing.
 */
export function loadTextFonts(target: FontLoaderTarget, sources: readonly TextFontFaceSource[] = DEFAULT_TEXT_FONT_SOURCES): Promise<void> {
  for (const source of sources) {
    const face = new FontFace(source.family, `url(${source.url})`, source.descriptors);
    target.fonts.add(face);
    // `.add()` alone leaves a `FontFace` "unloaded" — `FontFaceSet.ready` only waits on faces that
    // are actively loading, so `.load()` must be triggered explicitly for the gate below to hold.
    // The returned promise settles into the same success/failure state `ready` already reflects, so
    // there's nothing further to do with it here beyond not leaving it an unhandled rejection.
    void face.load().catch(() => undefined);
  }
  return target.fonts.ready.then(() => undefined);
}
