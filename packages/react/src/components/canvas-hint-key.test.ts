import { describe, expect, it } from "vitest";
import { catalogEn } from "../i18n/catalog-en";
import { canvasHintKey } from "./canvas-hint-key";

const state = (overrides: Partial<Parameters<typeof canvasHintKey>[0]> = {}) => ({
  tool: "select",
  hasSelection: false,
  isEditingText: false,
  ...overrides,
});

describe("canvasHintKey", () => {
  it("tells you how to draw with the active tool", () => {
    expect(canvasHintKey(state({ tool: "rectangle" }))).toBe("hint.rectangle");
  });

  it("switches from 'how to select' to 'what to do with the selection' once there is one", () => {
    expect(canvasHintKey(state())).toBe("hint.select");
    expect(canvasHintKey(state({ hasSelection: true }))).toBe("hint.selection");
  });

  it("only swaps that hint for the select tool — a drawing tool's own instruction still applies", () => {
    expect(canvasHintKey(state({ tool: "rectangle", hasSelection: true }))).toBe("hint.rectangle");
  });

  it("lets a live text edit override everything underneath it", () => {
    expect(canvasHintKey(state({ tool: "rectangle", hasSelection: true, isEditingText: true }))).toBe("hint.editingText");
  });

  it("stays silent for a tool with no hint of its own, rather than resolving to nothing", () => {
    expect(canvasHintKey(state({ tool: "laser" }))).toBeNull();
  });

  it("returns keys the catalog actually holds", () => {
    for (const tool of ["select", "rectangle", "text"]) {
      const key = canvasHintKey(state({ tool }))!;
      expect(catalogEn[key]).toBeTypeOf("string");
    }
    expect(catalogEn[canvasHintKey(state({ hasSelection: true }))!]).toBeTypeOf("string");
    expect(catalogEn[canvasHintKey(state({ isEditingText: true }))!]).toBeTypeOf("string");
  });
});
