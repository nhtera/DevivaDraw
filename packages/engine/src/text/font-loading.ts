/**
 * Font-family CSS stacks + a `fontsReady` gate for text measurement/render.
 *
 * No custom webfont files ship with this package yet: `"normal"`/`"code"` (see
 * `elements/text-element.ts`'s `TextFontFamily`) resolve to OS-provided font stacks rather than a
 * bundled `FontFace`, since this repo has no font-asset pipeline yet and the hand-drawn family is an
 * open licensing blocker (documented on `TextFontFamily` itself), not a code task to route around
 * with a placeholder asset. `loadTextFonts` is still a real gate — not a hardcoded no-op — structured
 * so a later licensed/commissioned font drops in as an entry in `sources` with zero call-site changes:
 * it registers every `FontFace` in `sources` (empty today) via the injected `target.fonts`, then
 * awaits `target.fonts.ready`, which resolves immediately when there's nothing custom to load.
 */
import type { TextFontFamily } from "../elements/text-element";

/** CSS `font-family` stack for each `TextFontFamily` slot; `"hand-drawn-slot"` falls back to the same stack as `"normal"` until a licensed font is wired into `sources` below. */
export const TEXT_FONT_FAMILY_CSS: Record<TextFontFamily, string> = {
  normal: '"Helvetica Neue", Arial, "Segoe UI", sans-serif',
  code: '"Cascadia Code", "Fira Code", Menlo, Consolas, monospace',
  "hand-drawn-slot": '"Helvetica Neue", Arial, "Segoe UI", sans-serif',
};

/** Named UI size levels -> pixel `fontSize`, matching `tools/shape-style-state.ts`'s `STROKE_WIDTH_LEVELS`/`SLOPPINESS_LEVELS` pattern. */
export const FONT_SIZE_LEVELS = { S: 16, M: 20, L: 28, XL: 36 } as const;

/** A webfont to register before the readiness gate resolves — unused today (see module doc), kept typed and exported so a licensed hand-drawn font is a one-line addition later. */
export interface TextFontFaceSource {
  family: string;
  url: string;
  descriptors?: FontFaceDescriptors;
}

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
export function loadTextFonts(target: FontLoaderTarget, sources: readonly TextFontFaceSource[] = []): Promise<void> {
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
