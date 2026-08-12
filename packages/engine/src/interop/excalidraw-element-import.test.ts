import { describe, expect, it } from "vitest";
import { importExcalidrawElements } from "./excalidraw-element-import";
import { ROUND_CORNER_ROUNDNESS_TYPE } from "../render/rough-renderer";
import type { ArrowElement, LineElement, TextElement } from "../elements/element-types";

/** A v2-generation rectangle with everything the reader cares about set to a non-default value. */
function v2Rectangle(overrides: Record<string, unknown> = {}) {
  return {
    type: "rectangle",
    id: "rect-1",
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    angle: 0.5,
    strokeColor: "#e03131",
    backgroundColor: "#ffc9c9",
    fillStyle: "cross-hatch",
    strokeWidth: 2,
    strokeStyle: "dashed",
    roughness: 2,
    opacity: 80,
    roundness: { type: 3 },
    seed: 12345,
    groupIds: ["g-1"],
    version: 999,
    versionNonce: 888,
    isDeleted: false,
    ...overrides,
  };
}

describe("importExcalidrawElements", () => {
  it("carries every style field across, and reuses the seed so the sketchy strokes match the original", () => {
    const [element] = importExcalidrawElements([v2Rectangle()]).elements;

    expect(element).toMatchObject({
      type: "rectangle",
      id: "rect-1",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      angle: 0.5,
      strokeColor: "#e03131",
      backgroundColor: "#ffc9c9",
      fillStyle: "cross-hatch",
      strokeWidth: 2,
      strokeStyle: "dashed",
      roughness: 2,
      opacity: 80,
      seed: 12345,
      groupIds: ["g-1"],
    });
  });

  it("resets the source document's version bookkeeping instead of importing it", () => {
    // Carrying a foreign document's version/nonce in would let a stale remote edit outrank the
    // freshly imported element the first time this scene merges with a peer.
    const [element] = importExcalidrawElements([v2Rectangle()]).elements;
    expect(element).toMatchObject({ version: 0, versionNonce: 0, updated: 0, index: "" });
  });

  it("collapses every Excalidraw rounding algorithm onto the one this renderer implements", () => {
    // `rough-renderer.ts` only draws rounded corners for `type === ROUND_CORNER_ROUNDNESS_TYPE`, so
    // passing `{type: 3}` (the modern adaptive-radius default) straight through would render sharp.
    for (const roundness of [{ type: 1 }, { type: 2 }, { type: 3 }]) {
      const [element] = importExcalidrawElements([v2Rectangle({ roundness })]).elements;
      expect(element!.roundness).toEqual({ type: ROUND_CORNER_ROUNDNESS_TYPE });
    }
    expect(importExcalidrawElements([v2Rectangle({ roundness: null })]).elements[0]!.roundness).toBeNull();
  });

  it("reads v1's `strokeSharpness` as the same rounding intent", () => {
    const round = importExcalidrawElements([{ type: "rectangle", x: 0, y: 0, strokeSharpness: "round" }]).elements[0]!;
    const sharp = importExcalidrawElements([{ type: "rectangle", x: 0, y: 0, strokeSharpness: "sharp" }]).elements[0]!;
    expect(round.roundness).toEqual({ type: ROUND_CORNER_ROUNDNESS_TYPE });
    expect(sharp.roundness).toBeNull();
  });

  it("converts `[x, y]` vertex pairs and drops malformed ones", () => {
    const raw = { type: "line", x: 0, y: 0, points: [[0, 0], [10, 5], ["bad", 1], [3], [7, Infinity], [20, 20]] };
    const line = importExcalidrawElements([raw]).elements[0] as LineElement;
    expect(line.points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 20 }]);
  });

  describe("text", () => {
    it("prefers `originalText` so the imported string is unwrapped", () => {
      // Excalidraw's `text` has its own wrap breaks baked in; this app re-derives the wrap at measure
      // time, so importing `text` would freeze a foreign layout into the stored data.
      const raw = { type: "text", x: 0, y: 0, text: "hello\nthere", originalText: "hello there", fontFamily: 1 };
      expect((importExcalidrawElements([raw]).elements[0] as TextElement).text).toBe("hello there");
    });

    it("falls back to `text` when the file predates `originalText`", () => {
      const raw = { type: "text", x: 0, y: 0, text: "Application\nserver" };
      expect((importExcalidrawElements([raw]).elements[0] as TextElement).text).toBe("Application\nserver");
    });

    it("maps numeric font-family ids, defaulting unknown ones to the sketchy face", () => {
      const familyFor = (fontFamily: number) =>
        (importExcalidrawElements([{ type: "text", x: 0, y: 0, text: "a", fontFamily }]).elements[0] as TextElement).fontFamily;
      expect(familyFor(1)).toBe("hand-drawn-slot");
      expect(familyFor(2)).toBe("normal");
      expect(familyFor(3)).toBe("code");
      expect(familyFor(5)).toBe("hand-drawn-slot");
      expect(familyFor(99)).toBe("hand-drawn-slot");
    });
  });

  describe("arrows", () => {
    const arrow = (overrides: Record<string, unknown>) =>
      importExcalidrawElements([{ type: "arrow", x: 0, y: 0, points: [[0, 0], [10, 10]], ...overrides }]).elements[0] as ArrowElement;

    it("reads the explicit `elbowed` flag", () => {
      expect(arrow({ elbowed: true }).arrowType).toBe("elbow");
    });

    it("only calls a rounded path curved when it actually has a bend to smooth", () => {
      expect(arrow({ roundness: { type: 2 } }).arrowType).toBe("straight");
      expect(arrow({ roundness: { type: 2 }, points: [[0, 0], [5, 8], [10, 10]] }).arrowType).toBe("curved");
      expect(arrow({ roundness: null }).arrowType).toBe("straight");
    });

    it("folds Excalidraw's extra arrowhead shapes onto the nearest supported cap", () => {
      expect(arrow({ endArrowhead: "circle_outline" }).endArrowhead).toBe("dot");
      expect(arrow({ endArrowhead: "diamond" }).endArrowhead).toBe("triangle");
      expect(arrow({ endArrowhead: "crowfoot_many" }).endArrowhead).toBe("arrow");
      expect(arrow({ startArrowhead: null }).startArrowhead).toBe("none");
    });
  });

  describe("freehand ink", () => {
    it("zips the separate `pressures` array onto the points, since that is where the taper lives", () => {
      // Excalidraw keeps two parallel arrays — `points: [[x, y]]` and `pressures: [p]` — not triples.
      // A pen-drawn stroke has `simulatePressure: false`, so the renderer uses these stored values as
      // the stroke's width; losing them flattens the taper the artist actually drew.
      const raw = { type: "freedraw", x: 0, y: 0, points: [[0, 0], [5, 5], [10, 2]], pressures: [0.1, 0.9, 0.4], simulatePressure: false };
      const element = importExcalidrawElements([raw]).elements[0]!;
      expect(element.type).toBe("freedraw");
      expect(element.type === "freedraw" && element.points).toEqual([[0, 0, 0.1], [5, 5, 0.9], [10, 2, 0.4]]);
      expect(element.type === "freedraw" && element.simulatePressure).toBe(false);
    });

    it("falls back to a neutral pressure when the stroke was simulated (pressures is empty)", () => {
      const raw = { type: "freedraw", x: 0, y: 0, points: [[0, 0], [5, 5]], pressures: [], simulatePressure: true };
      const element = importExcalidrawElements([raw]).elements[0]!;
      expect(element.type === "freedraw" && element.points).toEqual([[0, 0, 0.5], [5, 5, 0.5]]);
    });

    it("reads the legacy `draw` type as freedraw", () => {
      // Ink was called `draw` before Excalidraw renamed the type; libraries published then still use
      // it, and skipping it would import those items with their strokes missing.
      const raw = { type: "draw", x: 0, y: 0, points: [[0, 0], [4, 3]], strokeSharpness: "round" };
      const element = importExcalidrawElements([raw]).elements[0]!;
      expect(element.type).toBe("freedraw");
      expect(element.type === "freedraw" && element.points).toEqual([[0, 0, 0.5], [4, 3, 0.5]]);
      expect(element.type === "freedraw" && element.simulatePressure).toBe(true);
    });
  });

  describe("cross-element references", () => {
    it("reconstructs a v1 text-container link, which that generation only recorded on the container", () => {
      const result = importExcalidrawElements([
        { type: "rectangle", id: "box", x: 0, y: 0, boundElementIds: ["label"] },
        { type: "text", id: "label", x: 5, y: 5, text: "hi" },
      ]);
      expect((result.elements[1] as TextElement).containerId).toBe("box");
      // v1 stored no ref `type`; it is recoverable only once every element's type is known.
      expect(result.elements[0]!.boundElements).toEqual([{ id: "label", type: "text" }]);
    });

    it("clears references to elements that were skipped, rather than leaving them dangling", () => {
      const result = importExcalidrawElements([
        { type: "image", id: "pic", x: 0, y: 0, fileId: "f1" },
        { type: "rectangle", id: "box", x: 0, y: 0, boundElements: [{ id: "pic", type: "image" }] },
        { type: "arrow", id: "a", x: 0, y: 0, points: [[0, 0], [1, 1]], startBinding: { elementId: "pic", focus: 0, gap: 2 }, endBinding: { elementId: "box", focus: 0, gap: 2 } },
      ]);

      expect(result.skipped).toEqual({ image: 1 });
      expect(result.elements.find((element) => element.id === "box")!.boundElements).toBeNull();
      const arrow = result.elements.find((element) => element.id === "a") as ArrowElement;
      expect(arrow.startBinding).toBeNull();
      expect(arrow.endBinding).toEqual({ elementId: "box", focus: 0, gap: 2 });
    });
  });

  it("skips deleted and unsupported elements, counting the unsupported ones by type", () => {
    const result = importExcalidrawElements([
      v2Rectangle({ id: "gone", isDeleted: true }),
      { type: "image", x: 0, y: 0 },
      { type: "image", x: 0, y: 0 },
      { type: "selection", x: 0, y: 0 },
      v2Rectangle({ id: "kept" }),
    ]);
    expect(result.elements.map((element) => element.id)).toEqual(["kept"]);
    expect(result.skipped).toEqual({ image: 2, selection: 1 });
  });

  it("returns empty rather than throwing on junk input", () => {
    expect(importExcalidrawElements(null)).toEqual({ elements: [], skipped: {} });
    expect(importExcalidrawElements("nope")).toEqual({ elements: [], skipped: {} });
    expect(importExcalidrawElements([42, null, "x"])).toEqual({ elements: [], skipped: {} });
  });
});
