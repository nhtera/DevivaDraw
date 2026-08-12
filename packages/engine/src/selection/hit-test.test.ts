import { describe, expect, it } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { createFreedrawElement } from "../elements/freedraw-element";
import { createImageElement } from "../elements/image-element";
import { createDiamondElement, createEllipseElement, createLineElement, createParallelogramElement, createRectangleElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import { Scene } from "../scene/scene";
import { hitTestElement, topmostElementAt } from "./hit-test";

describe("hitTestElement — rectangle", () => {
  it("filled rectangle hits anywhere in the interior", () => {
    const rect = createRectangleElement({ x: 0, y: 0, width: 100, height: 50, backgroundColor: "#fff" });
    expect(hitTestElement({ ...rect, version: 1, versionNonce: 1, updated: 1, index: "a" }, { x: 50, y: 25 }, 2)).toBe(true);
  });

  it("unfilled rectangle misses the interior but hits near the border", () => {
    const rect = createRectangleElement({ x: 0, y: 0, width: 100, height: 50 });
    const stored = { ...rect, version: 1, versionNonce: 1, updated: 1, index: "a" };
    expect(hitTestElement(stored, { x: 50, y: 25 }, 2)).toBe(false); // dead center, unfilled
    expect(hitTestElement(stored, { x: 0, y: 25 }, 2)).toBe(true); // on the left edge
  });

  it("respects a zoom-scaled tolerance around the border", () => {
    const rect = createRectangleElement({ x: 0, y: 0, width: 100, height: 50 });
    const stored = { ...rect, version: 1, versionNonce: 1, updated: 1, index: "a" };
    expect(hitTestElement(stored, { x: -1, y: 25 }, 0.5)).toBe(false); // just outside a tight tolerance
    expect(hitTestElement(stored, { x: -1, y: 25 }, 2)).toBe(true); // within a looser (more-zoomed-out) tolerance
  });

  it("accounts for the element's own rotation", () => {
    // A 100x50 rect rotated 90deg around its center now spans ~50 wide x ~100 tall on screen.
    const rect = createRectangleElement({ x: 0, y: 0, width: 100, height: 50, angle: Math.PI / 2, backgroundColor: "#fff" });
    const stored = { ...rect, version: 1, versionNonce: 1, updated: 1, index: "a" };
    expect(hitTestElement(stored, { x: 50, y: 5 }, 2)).toBe(true); // near the rotated short edge, inside the rotated footprint
  });

  it("never hits a soft-deleted or locked element", () => {
    const rect = createRectangleElement({ x: 0, y: 0, width: 100, height: 50, backgroundColor: "#fff" });
    const deleted = { ...rect, version: 1, versionNonce: 1, updated: 1, index: "a", isDeleted: true };
    const locked = { ...rect, version: 1, versionNonce: 1, updated: 1, index: "a", locked: true };
    expect(hitTestElement(deleted, { x: 50, y: 25 }, 2)).toBe(false);
    expect(hitTestElement(locked, { x: 50, y: 25 }, 2)).toBe(false);
  });
});

describe("hitTestElement — diamond & ellipse", () => {
  it("diamond: hits its inscribed vertex, misses its bbox corner (both unfilled)", () => {
    const diamond = createDiamondElement({ x: 0, y: 0, width: 100, height: 100 });
    const stored = { ...diamond, version: 1, versionNonce: 1, updated: 1, index: "a" };
    expect(hitTestElement(stored, { x: 50, y: 0 }, 2)).toBe(true); // top vertex of the diamond
    expect(hitTestElement(stored, { x: 2, y: 2 }, 2)).toBe(false); // bbox corner, outside the diamond outline
  });

  it("ellipse: filled hits center, unfilled only hits near the rim", () => {
    const ellipse = createEllipseElement({ x: 0, y: 0, width: 100, height: 60, backgroundColor: "#fff" });
    const filled = { ...ellipse, version: 1, versionNonce: 1, updated: 1, index: "a" };
    expect(hitTestElement(filled, { x: 50, y: 30 }, 2)).toBe(true);

    const unfilled = { ...createEllipseElement({ x: 0, y: 0, width: 100, height: 60 }), version: 1, versionNonce: 1, updated: 1, index: "a" };
    expect(hitTestElement(unfilled, { x: 50, y: 30 }, 2)).toBe(false);
    expect(hitTestElement(unfilled, { x: 50, y: 0 }, 2)).toBe(true); // top of the rim
  });
});

describe("hitTestElement — line, arrow, freedraw", () => {
  it("line: hits near a segment, misses far from the path", () => {
    const line = createLineElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] });
    const stored = { ...line, version: 1, versionNonce: 1, updated: 1, index: "a" };
    expect(hitTestElement(stored, { x: 50, y: 1 }, 3)).toBe(true);
    expect(hitTestElement(stored, { x: 50, y: 20 }, 3)).toBe(false);
  });

  it("arrow: hits near its path", () => {
    const arrow = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 40, y: 40 }] });
    const stored = { ...arrow, version: 1, versionNonce: 1, updated: 1, index: "a" };
    expect(hitTestElement(stored, { x: 20, y: 20 }, 3)).toBe(true);
    expect(hitTestElement(stored, { x: 0, y: 40 }, 3)).toBe(false);
  });

  it("freedraw: bbox reject short-circuits before the per-point walk", () => {
    const stroke = createFreedrawElement({ x: 0, y: 0, width: 10, height: 10, points: [[0, 0, 0.5], [10, 10, 0.5]] });
    const stored = { ...stroke, version: 1, versionNonce: 1, updated: 1, index: "a" };
    expect(hitTestElement(stored, { x: 5, y: 5 }, 3)).toBe(true);
    expect(hitTestElement(stored, { x: 500, y: 500 }, 3)).toBe(false);
  });

  it("freedraw: a closed loop stays ink-only — a background color it can never render must not open up its interior", () => {
    // A rough square traced back to its start. Excalidraw would count the inside of this once the
    // stroke had a fill; here that fill is unrenderable, so an interior hit would have nothing on
    // screen to justify it. See the freedraw branch in `hit-test.ts`.
    const loop = createFreedrawElement({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [
        [0, 0, 0.5],
        [100, 0, 0.5],
        [100, 100, 0.5],
        [0, 100, 0.5],
        [0, 0, 0.5],
      ],
      backgroundColor: "#ff0000",
    });
    const stored = { ...loop, version: 1, versionNonce: 1, updated: 1, index: "a" };
    expect(hitTestElement(stored, { x: 50, y: 50 }, 3)).toBe(false); // dead centre, well inside the loop
    expect(hitTestElement(stored, { x: 50, y: 0 }, 3)).toBe(true); // on the traced edge
  });
});

describe("hitTestElement — text, image, and bound text exclusion", () => {
  it("text: bbox hit test", () => {
    const text = createTextElement({ x: 0, y: 0, width: 60, height: 20, text: "hi" });
    const stored = { ...text, version: 1, versionNonce: 1, updated: 1, index: "a" };
    expect(hitTestElement(stored, { x: 30, y: 10 }, 2)).toBe(true);
  });

  it("bound text (containerId set) is never directly hit — the container owns the click", () => {
    const text = createTextElement({ x: 0, y: 0, width: 60, height: 20, text: "hi", containerId: "container-1" });
    const stored = { ...text, version: 1, versionNonce: 1, updated: 1, index: "a" };
    expect(hitTestElement(stored, { x: 30, y: 10 }, 2)).toBe(false);
  });

  it("image: bbox hit test", () => {
    const image = createImageElement({ x: 0, y: 0, width: 80, height: 60, fileId: "f1", naturalWidth: 80, naturalHeight: 60 });
    const stored = { ...image, version: 1, versionNonce: 1, updated: 1, index: "a" };
    expect(hitTestElement(stored, { x: 40, y: 30 }, 2)).toBe(true);
    expect(hitTestElement(stored, { x: 500, y: 500 }, 2)).toBe(false);
  });
});

describe("hitTestElement — labelled containers", () => {
  /** An unfilled container carrying a bound-text ref, as `bindTextToContainer` leaves it. */
  const labelled = (overrides: Partial<Parameters<typeof createRectangleElement>[0]> = {}) => ({
    ...createRectangleElement({ x: 0, y: 0, width: 100, height: 50, ...overrides }),
    boundElements: [{ id: "label-1", type: "text" }],
    version: 1,
    versionNonce: 1,
    updated: 1,
    index: "a",
  });

  it("hits the empty space around the label, which an unlabelled unfilled shape would not", () => {
    // Off-center, so it is nowhere near the text itself — this is the gap the user actually clicks in.
    expect(hitTestElement(labelled(), { x: 80, y: 12 }, 2)).toBe(true);
    const bare = { ...createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }), version: 1, versionNonce: 1, updated: 1, index: "a" };
    expect(hitTestElement(bare, { x: 80, y: 12 }, 2)).toBe(false);
  });

  it("still stops at the shape's own outline", () => {
    expect(hitTestElement(labelled(), { x: 140, y: 25 }, 2)).toBe(false);
  });

  it("ignores non-text bindings — a shape with only bound arrows stays stroke-only", () => {
    const withArrow = {
      ...createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }),
      boundElements: [{ id: "arrow-1", type: "arrow" }],
      version: 1,
      versionNonce: 1,
      updated: 1,
      index: "a",
    };
    expect(hitTestElement(withArrow, { x: 50, y: 25 }, 2)).toBe(false);
  });

  it("applies to every closed shape a label can bind to, not just rectangles", () => {
    const ellipse = {
      ...createEllipseElement({ x: 0, y: 0, width: 100, height: 60 }),
      boundElements: [{ id: "label-1", type: "text" }],
      version: 1,
      versionNonce: 1,
      updated: 1,
      index: "a",
    };
    expect(hitTestElement(ellipse, { x: 50, y: 30 }, 2)).toBe(true);
  });
});

describe("hitTestElement — mirrored elements", () => {
  /**
   * A parallelogram leaning right: its top edge runs from x=25 to x=100, its bottom from x=0 to x=75.
   * So a point just inside the top-left corner is *outside* the shape, and its mirror image is inside —
   * which makes it a precise probe for whether a flipped outline is grabbed where it is drawn.
   */
  const leaning = (scale?: readonly [number, number]) => ({
    ...createParallelogramElement({ x: 0, y: 0, width: 100, height: 100 }),
    backgroundColor: "#fff", // filled, so the interior is the hit target
    ...(scale ? { scale } : {}),
    version: 1,
    versionNonce: 1,
    updated: 1,
    index: "a",
  });

  it("unmirrored: the shape leans away from the top-left corner", () => {
    expect(hitTestElement(leaning(), { x: 10, y: 10 }, 1)).toBe(false);
    expect(hitTestElement(leaning(), { x: 90, y: 10 }, 1)).toBe(true);
  });

  it("mirrored: the lean reverses, and so does which corner is inside it", () => {
    expect(hitTestElement(leaning([-1, 1]), { x: 10, y: 10 }, 1)).toBe(true);
    expect(hitTestElement(leaning([-1, 1]), { x: 90, y: 10 }, 1)).toBe(false);
  });

  it("leaves a symmetric outline unchanged, mirrored or not", () => {
    const circle = { ...createEllipseElement({ x: 0, y: 0, width: 100, height: 100, backgroundColor: "#fff" }), scale: [-1, 1] as const, version: 1, versionNonce: 1, updated: 1, index: "a" };
    expect(hitTestElement(circle, { x: 50, y: 50 }, 1)).toBe(true);
    expect(hitTestElement(circle, { x: 2, y: 2 }, 1)).toBe(false); // bbox corner, outside the circle
  });
});

describe("topmostElementAt", () => {
  it("returns the highest z-order element among overlapping candidates", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100, backgroundColor: "#fff" }));
    const top = scene.addElement(createRectangleElement({ x: 10, y: 10, width: 100, height: 100, backgroundColor: "#000" }));

    const hit = topmostElementAt(scene, { x: 50, y: 50 }, 2);
    expect(hit?.id).toBe(top.id);
  });

  it("returns null when nothing is under the point", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10, backgroundColor: "#fff" }));
    expect(topmostElementAt(scene, { x: 500, y: 500 }, 2)).toBeNull();
  });
});
