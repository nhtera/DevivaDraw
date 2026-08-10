import { describe, expect, it } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { DEFAULT_BACKGROUND_COLOR_PALETTE, DEFAULT_STROKE_COLOR_PALETTE, pickShapeStyle, ShapeStyleState } from "./shape-style-state";

describe("pickShapeStyle", () => {
  it("extracts exactly the style fields from an element (the copy-styles source)", () => {
    const element = createRectangleElement({ x: 0, y: 0, width: 10, height: 10, strokeColor: "#ff0000", backgroundColor: "#00ff00", strokeWidth: 4 });
    const style = pickShapeStyle(element);
    expect(style).toEqual({
      strokeColor: "#ff0000",
      backgroundColor: "#00ff00",
      fillStyle: element.fillStyle,
      strokeWidth: 4,
      strokeStyle: element.strokeStyle,
      roughness: element.roughness,
      opacity: element.opacity,
      roundness: element.roundness,
    });
    // Must not carry geometry/identity fields — pasting these onto another element would move/replace it.
    expect(style).not.toHaveProperty("x");
    expect(style).not.toHaveProperty("id");
  });
});

describe("ShapeStyleState", () => {
  it("starts with sane defaults matching the element factory defaults", () => {
    const state = new ShapeStyleState();
    expect(state.getStyle()).toEqual({
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      roundness: null,
    });
  });

  it("accepts an initial style override at construction", () => {
    const state = new ShapeStyleState({ strokeColor: "#ff0000" });
    expect(state.getStyle().strokeColor).toBe("#ff0000");
  });

  it("setStyle merges partial changes without clobbering untouched fields", () => {
    const state = new ShapeStyleState();
    state.setStyle({ strokeColor: "#00ff00" });
    expect(state.getStyle().strokeColor).toBe("#00ff00");
    expect(state.getStyle().fillStyle).toBe("solid"); // untouched field survives
  });

  it("persists the last-set style across multiple reads — 'keep current style for next shape'", () => {
    const state = new ShapeStyleState();
    state.setStyle({ strokeWidth: 4 });
    expect(state.getStyle().strokeWidth).toBe(4);
    expect(state.getStyle().strokeWidth).toBe(4); // reading again doesn't reset it
  });

  it("applyToSelection updates currentStyle the same way setStyle does (selection-aware branch lands later)", () => {
    const state = new ShapeStyleState();
    state.applyToSelection({ opacity: 50 });
    expect(state.getStyle().opacity).toBe(50);
  });

  it("records a newly-set stroke color into recentColors, most-recent first", () => {
    const state = new ShapeStyleState();
    state.setStyle({ strokeColor: "#111111" });
    state.setStyle({ strokeColor: "#222222" });
    expect(state.getRecentColors()).toEqual(["#222222", "#111111"]);
  });

  it("does not duplicate a color already in recentColors — re-picking it moves it to the front", () => {
    const state = new ShapeStyleState();
    state.setStyle({ strokeColor: "#111111" });
    state.setStyle({ strokeColor: "#222222" });
    state.setStyle({ strokeColor: "#111111" });
    expect(state.getRecentColors()).toEqual(["#111111", "#222222"]);
  });

  it("never records 'transparent' as a recently-used background color", () => {
    const state = new ShapeStyleState();
    state.setStyle({ backgroundColor: "transparent" });
    expect(state.getRecentColors()).toEqual([]);
  });

  it("caps recentColors at a fixed maximum, dropping the oldest", () => {
    const state = new ShapeStyleState();
    for (let i = 0; i < 12; i += 1) state.setStyle({ strokeColor: `#${i.toString(16).padStart(6, "0")}` });
    expect(state.getRecentColors().length).toBeLessThanOrEqual(8);
    expect(state.getRecentColors()[0]).toBe("#00000b"); // most recent (i=11) stays at the front
  });

  it("exposes non-empty default stroke/background color palettes", () => {
    expect(DEFAULT_STROKE_COLOR_PALETTE.length).toBeGreaterThan(0);
    expect(DEFAULT_BACKGROUND_COLOR_PALETTE.length).toBeGreaterThan(0);
  });

  describe("applyToSelection with a bound selection", () => {
    it("rewrites every selected, non-deleted element's style via Scene.updateElement", () => {
      const scene = new Scene();
      const a = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
      const b = scene.addElement(createRectangleElement({ x: 20, y: 0, width: 10, height: 10 }));
      const state = new ShapeStyleState();
      state.bindSelection({ scene, getSelectedIds: () => [a.id, b.id] });

      state.applyToSelection({ strokeColor: "#00ff00" });

      expect(scene.getElement(a.id)?.strokeColor).toBe("#00ff00");
      expect(scene.getElement(b.id)?.strokeColor).toBe("#00ff00");
      expect(state.getStyle().strokeColor).toBe("#00ff00"); // "next shape" default still updates too
    });

    it("skips a selected id that no longer resolves to a live element", () => {
      const scene = new Scene();
      const a = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
      scene.deleteElement(a.id);
      const state = new ShapeStyleState();
      state.bindSelection({ scene, getSelectedIds: () => [a.id, "missing-id"] });

      expect(() => state.applyToSelection({ strokeColor: "#00ff00" })).not.toThrow();
    });

    it("unbinding (calling bindSelection(undefined)) reverts to style-only behavior", () => {
      const scene = new Scene();
      const a = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
      const state = new ShapeStyleState();
      state.bindSelection({ scene, getSelectedIds: () => [a.id] });
      state.bindSelection(undefined);

      state.applyToSelection({ strokeColor: "#00ff00" });

      expect(scene.getElement(a.id)?.strokeColor).toBe("#1e1e1e"); // untouched
      expect(state.getStyle().strokeColor).toBe("#00ff00");
    });
  });
});
