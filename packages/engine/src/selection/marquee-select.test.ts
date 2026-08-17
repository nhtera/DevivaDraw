import { describe, expect, it } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { createRectangleElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import { elementsInMarquee, normalizeMarqueeRect, resolveMarqueeMode } from "./marquee-select";

function stored<T extends object>(element: T) {
  return { ...element, version: 1, versionNonce: 1, updated: 1, index: "a" };
}

describe("elementsInMarquee — degenerate (click) marquee", () => {
  it("selects nothing for a point-sized marquee, even when the point is inside an element's bbox", () => {
    // A large diagonal arrow: the click lands well inside its bounding box but nowhere near its ink.
    const arrow = createArrowElement({
      x: 300,
      y: 250,
      width: 300,
      height: 150,
      points: [
        { x: 0, y: 0 },
        { x: 300, y: 150 },
      ],
    });
    const clickRect = normalizeMarqueeRect({ x: 375, y: 287 }, { x: 375, y: 287 });

    expect(elementsInMarquee([arrow], clickRect, "intersect")).toEqual([]);
    expect(elementsInMarquee([arrow], clickRect, "contain")).toEqual([]);
  });

  it("still selects for a real drag along a single axis (zero height, non-zero width)", () => {
    const arrow = createArrowElement({
      x: 300,
      y: 250,
      width: 300,
      height: 150,
      points: [
        { x: 0, y: 0 },
        { x: 300, y: 150 },
      ],
    });
    const lineDrag = normalizeMarqueeRect({ x: 200, y: 300 }, { x: 700, y: 300 });

    expect(elementsInMarquee([arrow], lineDrag, "intersect")).toHaveLength(1);
  });
});

describe("normalizeMarqueeRect", () => {
  it("normalizes a rect dragged in any direction to non-negative width/height", () => {
    expect(normalizeMarqueeRect({ x: 50, y: 50 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    expect(normalizeMarqueeRect({ x: 0, y: 0 }, { x: 50, y: 50 })).toEqual({ x: 0, y: 0, width: 50, height: 50 });
  });
});

describe("elementsInMarquee", () => {
  const inside = stored(createRectangleElement({ x: 10, y: 10, width: 20, height: 20 }));
  const straddling = stored(createRectangleElement({ x: 40, y: 10, width: 40, height: 40 })); // overlaps marquee's right edge
  const outside = stored(createRectangleElement({ x: 200, y: 200, width: 10, height: 10 }));
  const marquee = { x: 0, y: 0, width: 60, height: 60 };

  it("intersect mode includes anything overlapping at all", () => {
    const hits = elementsInMarquee([inside, straddling, outside], marquee, "intersect");
    expect(hits.map((el) => el.id).sort()).toEqual([inside.id, straddling.id].sort());
  });

  it("contain mode only includes fully-enclosed elements", () => {
    const hits = elementsInMarquee([inside, straddling, outside], marquee, "contain");
    expect(hits.map((el) => el.id)).toEqual([inside.id]);
  });

  it("excludes soft-deleted and locked elements", () => {
    const deleted = { ...inside, id: "deleted-1", isDeleted: true };
    const locked = { ...inside, id: "locked-1", locked: true };
    const hits = elementsInMarquee([deleted, locked], marquee, "intersect");
    expect(hits).toEqual([]);
  });

  it("excludes bound text (containerId set)", () => {
    const boundText = stored(createTextElement({ x: 10, y: 10, width: 10, height: 10, containerId: "container-1" }));
    expect(elementsInMarquee([boundText], marquee, "intersect")).toEqual([]);
  });

  it("accounts for a rotated element's true on-screen footprint", () => {
    // A thin 40x4 rect rotated 90deg now spans ~4 wide x ~40 tall on screen, centered at (30, 22) —
    // its rotated footprint reaches y ~ 2..42, extending past a marquee that its unrotated bbox would fit inside.
    const rotated = stored(createRectangleElement({ x: 10, y: 20, width: 40, height: 4, angle: Math.PI / 2 }));
    expect(elementsInMarquee([rotated], { x: 0, y: 0, width: 60, height: 25 }, "contain")).toEqual([]);
  });
});

describe("resolveMarqueeMode", () => {
  it('"auto" keeps the drag-direction convention', () => {
    expect(resolveMarqueeMode("auto", false)).toBe("intersect"); // left-to-right
    expect(resolveMarqueeMode("auto", true)).toBe("contain"); // right-to-left
  });

  it('"wrap" forces fully-enclosed selection in BOTH drag directions', () => {
    expect(resolveMarqueeMode("wrap", false)).toBe("contain");
    expect(resolveMarqueeMode("wrap", true)).toBe("contain");
  });

  it('"overlap" forces touched-counts selection in BOTH drag directions', () => {
    expect(resolveMarqueeMode("overlap", false)).toBe("intersect");
    expect(resolveMarqueeMode("overlap", true)).toBe("intersect");
  });
});
