import { describe, expect, it, vi } from "vitest";
import { FONT_SIZE_LEVELS, loadTextFonts, TEXT_FONT_FAMILY_CSS } from "./font-loading";

describe("TEXT_FONT_FAMILY_CSS", () => {
  it("defines a CSS stack for every TextFontFamily slot, including the not-yet-licensed hand-drawn slot", () => {
    expect(TEXT_FONT_FAMILY_CSS.normal).toContain("sans-serif");
    expect(TEXT_FONT_FAMILY_CSS.code).toContain("monospace");
    // No licensed hand-drawn asset exists yet (see module doc) — it must still resolve to a real,
    // renderable stack rather than an empty/undefined string.
    expect(TEXT_FONT_FAMILY_CSS["hand-drawn-slot"]).toBe(TEXT_FONT_FAMILY_CSS.normal);
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
  it("resolves once the injected target's fonts.ready settles, with no sources to register", async () => {
    const target = { fonts: { add: vi.fn(), ready: Promise.resolve(undefined) } };
    await expect(loadTextFonts(target)).resolves.toBeUndefined();
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
