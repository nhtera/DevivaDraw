import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TEXT_FONT_SOURCES, FONT_SIZE_LEVELS, loadTextFonts, TEXT_FONT_FAMILY_CSS } from "./font-loading";
import { HAND_DRAWN_FONT_FAMILY } from "./hand-drawn-font-data";

describe("TEXT_FONT_FAMILY_CSS", () => {
  it("defines a CSS stack for every TextFontFamily slot; the hand-drawn slot leads with the bundled font and falls back to sans", () => {
    expect(TEXT_FONT_FAMILY_CSS.normal).toContain("sans-serif");
    expect(TEXT_FONT_FAMILY_CSS.code).toContain("monospace");
    // Leads with the bundled Excalifont family, then the sans stack for any glyph the subset lacks.
    expect(TEXT_FONT_FAMILY_CSS["hand-drawn-slot"]).toContain(HAND_DRAWN_FONT_FAMILY);
    expect(TEXT_FONT_FAMILY_CSS["hand-drawn-slot"]).toContain("sans-serif");
  });
});

describe("DEFAULT_TEXT_FONT_SOURCES", () => {
  it("ships the bundled hand-drawn font as a self-contained base64 woff2 data URI (no external host)", () => {
    expect(DEFAULT_TEXT_FONT_SOURCES).toHaveLength(1);
    expect(DEFAULT_TEXT_FONT_SOURCES[0]!.family).toBe(HAND_DRAWN_FONT_FAMILY);
    expect(DEFAULT_TEXT_FONT_SOURCES[0]!.url.startsWith("data:font/woff2;base64,")).toBe(true);
  });
});

describe("FONT_SIZE_LEVELS", () => {
  it("defines S/M/L/XL as ascending pixel sizes", () => {
    expect(FONT_SIZE_LEVELS.S).toBeLessThan(FONT_SIZE_LEVELS.M);
    expect(FONT_SIZE_LEVELS.M).toBeLessThan(FONT_SIZE_LEVELS.L);
    expect(FONT_SIZE_LEVELS.L).toBeLessThan(FONT_SIZE_LEVELS.XL);
  });
});

describe("loadTextFonts", () => {
  it("resolves once the injected target's fonts.ready settles, registering nothing when given an empty source list", async () => {
    const target = { fonts: { add: vi.fn(), ready: Promise.resolve(undefined) } };
    await expect(loadTextFonts(target, [])).resolves.toBeUndefined();
    expect(target.fonts.add).not.toHaveBeenCalled();
  });

  it("registers and loads every supplied FontFace source before the gate resolves", async () => {
    const loadedFaces: string[] = [];
    class FakeFontFace {
      family: string;
      constructor(family: string) {
        this.family = family;
      }
      load(): Promise<void> {
        loadedFaces.push(this.family);
        return Promise.resolve();
      }
    }
    // `loadTextFonts` constructs `FontFace` directly (a DOM global) — stub it for this Node test env.
    vi.stubGlobal("FontFace", FakeFontFace);

    const target = { fonts: { add: vi.fn(), ready: Promise.resolve(undefined) } };
    await loadTextFonts(target, [{ family: "Deviva Hand", url: "/fonts/deviva-hand.woff2" }]);

    expect(target.fonts.add).toHaveBeenCalledTimes(1);
    expect(loadedFaces).toEqual(["Deviva Hand"]);

    vi.unstubAllGlobals();
  });
});
