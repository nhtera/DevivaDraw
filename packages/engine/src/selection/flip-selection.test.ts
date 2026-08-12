import { describe, expect, it } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { createFreedrawElement } from "../elements/freedraw-element";
import { createImageElement } from "../elements/image-element";
import { createTextElement } from "../elements/text-element";
import {
  createBlockArrowElement,
  createCheckBoxElement,
  createCloudElement,
  createLineElement,
  createParallelogramElement,
  createRectangleElement,
  createTriangleElement,
} from "../elements/shape-elements";
import type { AnyElement } from "../elements/element-types";
import { computeFlipChanges } from "./flip-selection";

/** Element factories return a pre-insert shape; `Scene` stamps the rest. These tests never touch a scene. */
function stored(element: object): AnyElement {
  return { ...element, version: 1, versionNonce: 1, updated: 1, index: "a" } as unknown as AnyElement;
}

/**
 * `ElementUpdate` is a `Partial` over the whole element *union*, so it only surfaces the fields every
 * type shares — `points`/`direction` belong to one branch each and are invisible through it.
 */
interface FlipChanges {
  x?: number;
  y?: number;
  angle?: number;
  points?: unknown;
  direction?: unknown;
  scale?: unknown;
}

const changesFor = (elements: AnyElement[], axis: "horizontal" | "vertical", id: string): FlipChanges =>
  computeFlipChanges(elements, axis).find((change) => change.id === id)!.changes as FlipChanges;

describe("computeFlipChanges — positions", () => {
  it("swaps two elements across the selection's centre line", () => {
    const left = stored(createRectangleElement({ x: 0, y: 0, width: 20, height: 10 }));
    const right = stored(createRectangleElement({ x: 80, y: 0, width: 20, height: 10 }));
    const elements = [left, right];

    // Selection spans x 0..100, so the left box's far edge (20) lands at 100-20 = 80.
    expect(changesFor(elements, "horizontal", left.id).x).toBe(80);
    expect(changesFor(elements, "horizontal", right.id).x).toBe(0);
  });

  it("leaves a lone shape exactly where it was — its box is the selection's, so only its own mirror changes", () => {
    const rect = stored(createRectangleElement({ x: 40, y: 10, width: 20, height: 10 }));
    expect(changesFor([rect], "horizontal", rect.id)).toEqual({ x: 40, scale: [-1, 1] });
  });

  it("mirrors along one axis only — a horizontal flip never moves anything vertically", () => {
    const a = stored(createRectangleElement({ x: 0, y: 0, width: 20, height: 10 }));
    const b = stored(createRectangleElement({ x: 80, y: 50, width: 20, height: 10 }));
    expect(changesFor([a, b], "horizontal", b.id).y).toBeUndefined();
    expect(changesFor([a, b], "vertical", b.id).x).toBeUndefined();
  });

  it("mirrors a rotated element's rotation with it", () => {
    const rect = stored(createRectangleElement({ x: 0, y: 0, width: 20, height: 10, angle: Math.PI / 6 }));
    expect(changesFor([rect], "horizontal", rect.id).angle!).toBeCloseTo(2 * Math.PI - Math.PI / 6, 6);
  });

  it("ignores deleted elements, which must not drag the selection bounds around", () => {
    const live = stored(createRectangleElement({ x: 0, y: 0, width: 20, height: 10 }));
    const deleted = { ...stored(createRectangleElement({ x: 400, y: 0, width: 20, height: 10 })), isDeleted: true };
    const changes = computeFlipChanges([live, deleted], "horizontal");
    expect(changes).toHaveLength(1);
    expect(changes[0]!.changes).toEqual({ x: 0, scale: [-1, 1] });
  });
});

describe("computeFlipChanges — geometry", () => {
  it("mirrors a line's vertices, so the drawn path really is reversed", () => {
    const line = stored(
      createLineElement({
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 50 },
          { x: 100, y: 10 },
        ],
      }),
    );
    expect(changesFor([line], "horizontal", line.id).points).toEqual([
      { x: 100, y: 0 },
      { x: 80, y: 50 },
      { x: 0, y: 10 },
    ]);
  });

  it("mirrors an arrow the same way", () => {
    const arrow = stored(
      createArrowElement({
        x: 0,
        y: 0,
        width: 60,
        height: 40,
        points: [
          { x: 0, y: 0 },
          { x: 60, y: 40 },
        ],
      }),
    );
    expect(changesFor([arrow], "vertical", arrow.id).points).toEqual([
      { x: 0, y: 40 },
      { x: 60, y: 0 },
    ]);
  });

  it("keeps freedraw's pressure channel while mirroring its coordinates", () => {
    const freedraw = stored(
      createFreedrawElement({
        x: 0,
        y: 0,
        width: 10,
        height: 4,
        points: [
          [0, 0, 0.5],
          [10, 4, 0.9],
        ],
      }),
    );
    expect(changesFor([freedraw], "horizontal", freedraw.id).points).toEqual([
      [10, 0, 0.5],
      [0, 4, 0.9],
    ]);
  });

  it("turns a block arrow around instead of leaving it pointing the old way", () => {
    const arrow = stored(createBlockArrowElement({ x: 0, y: 0, width: 40, height: 20, direction: "right" }));
    expect(changesFor([arrow], "horizontal", arrow.id).direction).toBe("left");
    // A vertical flip does not change which way a left/right arrow points.
    expect(changesFor([arrow], "vertical", arrow.id).direction).toBe("right");
  });
});

describe("computeFlipChanges — outlines that carry no mirrored variant", () => {
  const box = { x: 0, y: 0, width: 40, height: 40 };

  it("records the mirror on the element rather than faking it with a half turn", () => {
    const triangle = stored(createTriangleElement(box));
    expect(changesFor([triangle], "vertical", triangle.id).scale).toEqual([1, -1]);
    expect(changesFor([triangle], "vertical", triangle.id).angle).toBeUndefined();
    expect(changesFor([triangle], "horizontal", triangle.id).scale).toEqual([-1, 1]);
  });

  it("covers the shapes symmetric about neither axis, which no rotation could ever flip", () => {
    for (const create of [createParallelogramElement, createCloudElement, createCheckBoxElement]) {
      const shape = stored(create(box));
      expect(changesFor([shape], "horizontal", shape.id).scale).toEqual([-1, 1]);
      expect(changesFor([shape], "vertical", shape.id).scale).toEqual([1, -1]);
    }
  });

  it("mirrors an image the same way — a photo has no mirrored variant either", () => {
    const image = stored(createImageElement({ ...box, fileId: "f1", naturalWidth: 160, naturalHeight: 120 }));
    expect(changesFor([image], "horizontal", image.id).scale).toEqual([-1, 1]);
    expect(changesFor([image], "horizontal", image.id).angle).toBeUndefined();
  });

  it("flipping the same way twice puts an element back", () => {
    const flipped = stored(createImageElement({ ...box, fileId: "f1", naturalWidth: 160, naturalHeight: 120, scale: [-1, 1] }));
    expect(changesFor([flipped], "horizontal", flipped.id).scale).toEqual([1, 1]);
  });

  it("never mirrors text, which would render the label as mirror writing", () => {
    const text = stored(createTextElement({ ...box, text: "Label", fontSize: 20, fontFamily: "normal" }));
    expect(changesFor([text], "vertical", text.id).scale).toBeUndefined();
    expect(changesFor([text], "vertical", text.id).angle).toBeUndefined();
  });
});
