import { describe, expect, it } from "vitest";
import { resolveSystemThemeMode, resolveThemeTokens, toCssVariables } from "./theme-tokens";

describe("resolveThemeTokens", () => {
  it("returns distinct canvas backgrounds for light vs dark", () => {
    const light = resolveThemeTokens("light");
    const dark = resolveThemeTokens("dark");
    expect(light.canvasBackground).not.toBe(dark.canvasBackground);
  });

  it("light mode's canvas background is a light color, dark mode's is a dark color", () => {
    expect(resolveThemeTokens("light").canvasBackground.toLowerCase()).toBe("#ffffff");
    expect(resolveThemeTokens("dark").canvasBackground).not.toBe("#ffffff");
  });
});

describe("toCssVariables", () => {
  it("kebab-cases camelCase keys under a --dd- prefix", () => {
    const vars = toCssVariables(resolveThemeTokens("light"));
    expect(vars["--dd-canvas-background"]).toBe("#ffffff");
    expect(vars["--dd-chrome-background-elevated"]).toBeDefined();
  });

  it("produces one CSS variable per token field", () => {
    const tokens = resolveThemeTokens("dark");
    const vars = toCssVariables(tokens);
    expect(Object.keys(vars)).toHaveLength(Object.keys(tokens).length);
  });
});

describe("resolveSystemThemeMode", () => {
  it("resolves to dark when the media query matches", () => {
    expect(resolveSystemThemeMode(true)).toBe("dark");
  });

  it("resolves to light when the media query doesn't match or is unavailable", () => {
    expect(resolveSystemThemeMode(false)).toBe("light");
    expect(resolveSystemThemeMode(undefined)).toBe("light");
  });
});
