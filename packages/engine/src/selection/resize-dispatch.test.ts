import { describe, expect, it } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import type { ArrowElement } from "../elements/arrow-element";
import { createFreedrawElement } from "../elements/freedraw-element";
import type { FreedrawElement } from "../elements/freedraw-element";
import { createImageElement } from "../elements/image-element";
import { createFrameElement } from "../elements/frame-element";
import { createNoteElement } from "../elements/note-element";
import {
  createBlockArrowElement,
  createCheckBoxElement,
  createCloudElement,
  createHeartElement,
  createHexagonElement,
  createLineElement,
  createRectangleElement,
  createStarElement,
  createTriangleElement,
  createXBoxElement,
} from "../elements/shape-elements";
import type { LineElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import type { TextElement } from "../elements/text-element";
import type { AnyElement } from "../elements/element-types";
import { dispatchResize } from "./resize-dispatch";

/** Fills in the store-owned bookkeeping fields a factory leaves at sentinel values, matching what `Scene.addElement` would produce. */
function stored<T extends object>(element: T): T & Pick<AnyElement, "version" | "versionNonce" | "updated" | "index"> {
  return { ...element, version: 1, versionNonce: 1, updated: 1, index: "a" };
}

describe("dispatchResize — rectangle/ellipse/diamond/generic", () => {
  it("scales bounds directly", () => {
    const rect = stored(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    const result = dispatchResize(rect, { x: 0, y: 0, width: 100, height: 50 }, { x: 10, y: 10, width: 200, height: 100 });
    expect(result).toEqual({ x: 10, y: 10, width: 200, height: 100 });
  });

  it("clamps a collapsed resize to the minimum element size", () => {
    const rect = stored(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    const result = dispatchResize(rect, { x: 0, y: 0, width: 100, height: 50 }, { x: 0, y: 0, width: 0, height: -10 });
    expect(result?.width).toBeGreaterThan(0);
    expect(result?.height).toBeGreaterThan(0);
  });
});

describe("dispatchResize — every bounding-box shape resizes (regression: they used to fall through to null)", () => {
  const shapes = {
    triangle: createTriangleElement({ x: 0, y: 0, width: 100, height: 100 }),
    hexagon: createHexagonElement({ x: 0, y: 0, width: 100, height: 100 }),
    star: createStarElement({ x: 0, y: 0, width: 100, height: 100 }),
    cloud: createCloudElement({ x: 0, y: 0, width: 100, height: 100 }),
    heart: createHeartElement({ x: 0, y: 0, width: 100, height: 100 }),
    "x-box": createXBoxElement({ x: 0, y: 0, width: 100, height: 100 }),
    "check-box": createCheckBoxElement({ x: 0, y: 0, width: 100, height: 100 }),
    "block-arrow": createBlockArrowElement({ x: 0, y: 0, width: 100, height: 100, direction: "right" }),
    note: createNoteElement({ x: 0, y: 0, width: 100, height: 100 }),
    frame: createFrameElement({ x: 0, y: 0, width: 100, height: 100, name: "Frame 1" }),
  };

  for (const [label, element] of Object.entries(shapes)) {
    it(`${label} scales its bounds instead of returning null`, () => {
      const result = dispatchResize(stored(element), { x: 0, y: 0, width: 100, height: 100 }, { x: 5, y: 5, width: 200, height: 150 });
      expect(result).toEqual({ x: 5, y: 5, width: 200, height: 150 });
    });
  }
});

describe("dispatchResize — line/arrow", () => {
  it("scales the point array proportionally, not just the bbox", () => {
    const line = stored(createLineElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 50 }] }));
    const result = dispatchResize(line, { x: 0, y: 0, width: 100, height: 50 }, { x: 0, y: 0, width: 200, height: 100 }) as Partial<LineElement> | null;
    expect(result?.points).toEqual([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 100 }]);
  });

  it("arrow points scale the same way", () => {
    const arrow = stored(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 40, y: 20 }] }));
    const result = dispatchResize(arrow, { x: 0, y: 0, width: 40, height: 20 }, { x: 0, y: 0, width: 80, height: 10 }) as Partial<ArrowElement> | null;
    expect(result?.points).toEqual([{ x: 0, y: 0 }, { x: 80, y: 10 }]);
  });
});

describe("dispatchResize — freedraw", () => {
  it("scales x/y of every point, preserving pressure", () => {
    const stroke = stored(
      createFreedrawElement({ x: 0, y: 0, width: 10, height: 10, points: [[0, 0, 0.2], [10, 10, 0.8]] }),
    );
    const result = dispatchResize(stroke, { x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 20, height: 5 }) as Partial<FreedrawElement> | null;
    expect(result?.points).toEqual([[0, 0, 0.2], [20, 5, 0.8]]);
  });
});

describe("dispatchResize — text", () => {
  it("standalone text scales fontSize with the geometric-mean scale and applies new bounds", () => {
    const text = stored(createTextElement({ x: 0, y: 0, width: 100, height: 20, fontSize: 20 }));
    const result = dispatchResize(text, { x: 0, y: 0, width: 100, height: 20 }, { x: 0, y: 0, width: 200, height: 40 }) as Partial<TextElement> | null;
    expect(result?.fontSize).toBeCloseTo(40, 5); // 2x both axes -> 2x font size
    expect(result).toMatchObject({ width: 200, height: 40 });
  });

  it("bound text (containerId set) is skipped — resized via its container instead", () => {
    const text = stored(createTextElement({ x: 0, y: 0, width: 100, height: 20, containerId: "c1" }));
    const result = dispatchResize(text, { x: 0, y: 0, width: 100, height: 20 }, { x: 0, y: 0, width: 200, height: 40 });
    expect(result).toBeNull();
  });

  it("clamps fontSize to a minimum readable size", () => {
    const text = stored(createTextElement({ x: 0, y: 0, width: 100, height: 20, fontSize: 20 }));
    const result = dispatchResize(text, { x: 0, y: 0, width: 100, height: 20 }, { x: 0, y: 0, width: 1, height: 1 }) as Partial<TextElement> | null;
    expect(result?.fontSize).toBeGreaterThanOrEqual(4);
  });
});

describe("dispatchResize — image", () => {
  it("preserves natural aspect ratio when the width-driven axis changes most", () => {
    const image = stored(createImageElement({ x: 0, y: 0, width: 100, height: 50, fileId: "f1", naturalWidth: 100, naturalHeight: 50 }));
    const result = dispatchResize(image, { x: 0, y: 0, width: 100, height: 50 }, { x: 0, y: 0, width: 200, height: 50 });
    expect(result?.width).toBe(200);
    expect(result?.height).toBe(100); // aspect (2:1) preserved from width, not the handle's raw height delta
  });

  it("preserves aspect ratio when the height-driven axis changes most", () => {
    const image = stored(createImageElement({ x: 0, y: 0, width: 100, height: 50, fileId: "f1", naturalWidth: 100, naturalHeight: 50 }));
    const result = dispatchResize(image, { x: 0, y: 0, width: 100, height: 50 }, { x: 0, y: 0, width: 100, height: 100 });
    expect(result?.height).toBe(100);
    expect(result?.width).toBe(200);
  });
});
