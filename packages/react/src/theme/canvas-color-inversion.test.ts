import { createRectangleElement, DEFAULT_BACKGROUND_COLOR_PALETTE, DEFAULT_STROKE_COLOR_PALETTE, Scene } from "@deviva-draw/engine";
import { describe, expect, it } from "vitest";
import { adaptBackgroundColorForTheme, adaptStrokeColorForTheme, applyThemeToSceneElements } from "./canvas-color-inversion";

describe("adaptStrokeColorForTheme", () => {
  it("swaps a known default-palette stroke color to its dark counterpart", () => {
    const defaultColor = DEFAULT_STROKE_COLOR_PALETTE[0]!;
    const dark = adaptStrokeColorForTheme(defaultColor, "dark");
    expect(dark).not.toBe(defaultColor);
  });

  it("round-trips light -> dark -> light back to the exact original color", () => {
    const defaultColor = DEFAULT_STROKE_COLOR_PALETTE[1]!;
    const dark = adaptStrokeColorForTheme(defaultColor, "dark");
    const backToLight = adaptStrokeColorForTheme(dark, "light");
    expect(backToLight).toBe(defaultColor);
  });

  it("leaves a custom (non-default-palette) color completely unchanged in either mode", () => {
    const customColor = "#ff00aa";
    expect(adaptStrokeColorForTheme(customColor, "dark")).toBe(customColor);
    expect(adaptStrokeColorForTheme(customColor, "light")).toBe(customColor);
  });
});

describe("adaptBackgroundColorForTheme", () => {
  it("keeps 'transparent' unchanged in both modes", () => {
    expect(adaptBackgroundColorForTheme("transparent", "dark")).toBe("transparent");
    expect(adaptBackgroundColorForTheme("transparent", "light")).toBe("transparent");
  });

  it("swaps a known default-palette background color to its dark counterpart", () => {
    const defaultColor = DEFAULT_BACKGROUND_COLOR_PALETTE[1]!;
    expect(adaptBackgroundColorForTheme(defaultColor, "dark")).not.toBe(defaultColor);
  });
});

describe("applyThemeToSceneElements", () => {
  it("swaps default-palette colors on every non-deleted element, in place", () => {
    const scene = new Scene();
    const el = scene.addElement(
      createRectangleElement({ x: 0, y: 0, width: 10, height: 10, strokeColor: DEFAULT_STROKE_COLOR_PALETTE[0], backgroundColor: DEFAULT_BACKGROUND_COLOR_PALETTE[1] }),
    );

    applyThemeToSceneElements(scene, "dark");

    const updated = scene.getElement(el.id)!;
    expect(updated.strokeColor).not.toBe(DEFAULT_STROKE_COLOR_PALETTE[0]);
    expect(updated.backgroundColor).not.toBe(DEFAULT_BACKGROUND_COLOR_PALETTE[1]);
  });

  it("preserves an element's explicitly custom color across a theme swap", () => {
    const scene = new Scene();
    const el = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10, strokeColor: "#123456", backgroundColor: "#abcdef" }));

    applyThemeToSceneElements(scene, "dark");

    const updated = scene.getElement(el.id)!;
    expect(updated.strokeColor).toBe("#123456");
    expect(updated.backgroundColor).toBe("#abcdef");
  });

  it("skips soft-deleted elements", () => {
    const scene = new Scene();
    const el = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10, strokeColor: DEFAULT_STROKE_COLOR_PALETTE[0] }));
    scene.deleteElement(el.id);

    applyThemeToSceneElements(scene, "dark");

    expect(scene.getElement(el.id)!.strokeColor).toBe(DEFAULT_STROKE_COLOR_PALETTE[0]);
  });

  it("batches the mutation into a single history step when a history guard is provided", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10, strokeColor: DEFAULT_STROKE_COLOR_PALETTE[0] }));
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10, strokeColor: DEFAULT_STROKE_COLOR_PALETTE[1] }));
    const calls: string[] = [];
    const history = {
      beginBatch: () => calls.push("begin"),
      endBatch: () => calls.push("end"),
    };

    applyThemeToSceneElements(scene, "dark", history);

    expect(calls).toEqual(["begin", "end"]);
  });
});
