import { describe, expect, it } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import {
  HANDLE_GRAB_PX,
  hitLinearHandle,
  linearHandleLayout,
  MIDPOINT_HOVER_PX,
  MIN_SEGMENT_FOR_MIDPOINT_PX,
} from "./linear-handles";

/** A horizontal 2-point arrow from (0,0) to (200,0). */
const straightArrow = () => createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] });
/** A 3-point arrow: (0,0) -> (200,0) -> (200,200). */
const bentArrow = () =>
  createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }] });

describe("linearHandleLayout", () => {
  it("puts a handle on every stored vertex, in order", () => {
    expect(linearHandleLayout(straightArrow(), 1).vertices).toEqual([
      { index: 0, point: { x: 0, y: 0 } },
      { index: 1, point: { x: 200, y: 0 } },
    ]);
  });

  it("offers a two-point arrow's only midpoint always, hover or not — nothing else could be meant", () => {
    expect(linearHandleLayout(straightArrow(), 1).midpoint).toEqual({ segmentIndex: 0, point: { x: 100, y: 0 }, hovered: false });
  });

  it("marks a two-point arrow's midpoint hovered once the pointer reaches it, so the renderer can swell it", () => {
    expect(linearHandleLayout(straightArrow(), 1, { x: 100, y: 3 }).midpoint?.hovered).toBe(true);
    expect(linearHandleLayout(straightArrow(), 1, { x: 100, y: MIDPOINT_HOVER_PX + 2 }).midpoint?.hovered).toBe(false);
  });

  it("offers a multi-point arrow no midpoint without a hover point — mid-drag there is nothing to insert", () => {
    expect(linearHandleLayout(bentArrow(), 1).midpoint).toBeNull();
  });

  it("offers the midpoint of the segment the pointer is near", () => {
    expect(linearHandleLayout(bentArrow(), 1, { x: 100, y: 3 }).midpoint).toEqual({ segmentIndex: 0, point: { x: 100, y: 0 }, hovered: true });
  });

  it("offers a multi-point arrow nothing once the pointer is beyond the hover radius", () => {
    expect(linearHandleLayout(bentArrow(), 1, { x: 100, y: MIDPOINT_HOVER_PX + 2 }).midpoint).toBeNull();
  });

  it("picks the nearest segment when a bend puts two in range", () => {
    const arrow = bentArrow();
    expect(linearHandleLayout(arrow, 1, { x: 100, y: 2 })?.midpoint?.segmentIndex).toBe(0);
    expect(linearHandleLayout(arrow, 1, { x: 198, y: 100 })?.midpoint?.segmentIndex).toBe(1);
  });

  it("suppresses the midpoint on a segment too short to aim at independently of its own endpoints", () => {
    const short = MIN_SEGMENT_FOR_MIDPOINT_PX - 2;
    const arrow = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: short, y: 0 }] });
    expect(linearHandleLayout(arrow, 1, { x: short / 2, y: 0 }).midpoint).toBeNull();
  });

  it("scales the hover radius with zoom, so the dot appears at the same screen distance", () => {
    const arrow = bentArrow();
    const justOutsideAtFullZoom = { x: 100, y: MIDPOINT_HOVER_PX + 4 };
    expect(linearHandleLayout(arrow, 1, justOutsideAtFullZoom).midpoint).toBeNull();
    // Zoomed out, the same scene distance is a much shorter screen distance — so it is in range.
    expect(linearHandleLayout(arrow, 0.25, justOutsideAtFullZoom).midpoint).not.toBeNull();
  });

  it("uses an elbow arrow's stored endpoints, not the corners of its routed dogleg", () => {
    const elbow = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 200, y: 150 }], arrowType: "elbow" });
    const layout = linearHandleLayout(elbow, 1);
    expect(layout.vertices).toHaveLength(2);
    expect(layout.vertices.map((vertex) => vertex.point)).toEqual([{ x: 0, y: 0 }, { x: 200, y: 150 }]);
  });
});

describe("hitLinearHandle", () => {
  const layout = (hover?: { x: number; y: number }) => linearHandleLayout(straightArrow(), 1, hover);

  it("grabs a vertex the pointer is on", () => {
    expect(hitLinearHandle(layout(), { x: 0, y: 0 }, 1)).toEqual({ kind: "vertex", index: 0 });
    expect(hitLinearHandle(layout(), { x: 200, y: 0 }, 1)).toEqual({ kind: "vertex", index: 1 });
  });

  it("grabs a vertex from slightly off-centre, within the forgiving hitbox", () => {
    expect(hitLinearHandle(layout(), { x: HANDLE_GRAB_PX - 1, y: 0 }, 1)).toEqual({ kind: "vertex", index: 0 });
  });

  it("misses everything beyond the hitbox", () => {
    expect(hitLinearHandle(layout(), { x: HANDLE_GRAB_PX + 2, y: 0 }, 1)).toBeNull();
    expect(hitLinearHandle(layout(), { x: 100, y: HANDLE_GRAB_PX + 2 }, 1)).toBeNull(); // off the midpoint dot, off the line
  });

  it("grabs the midpoint dot when one is offered", () => {
    expect(hitLinearHandle(layout({ x: 100, y: 0 }), { x: 100, y: 0 }, 1)).toEqual({ kind: "midpoint", segmentIndex: 0 });
  });

  it("prefers a vertex over a midpoint when both are in range", () => {
    // A short arrow whose midpoint sits inside the endpoints' hitboxes. Dragging an endpoint is the
    // commoner intent, and silently inserting a bend instead would be the worse mistake.
    const arrow = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 400, y: 0 }] });
    const withHover = linearHandleLayout(arrow, 1, { x: 200, y: 0 });
    expect(hitLinearHandle(withHover, { x: 200, y: 0 }, 1)).toEqual({ kind: "midpoint", segmentIndex: 0 });
    expect(hitLinearHandle(withHover, { x: 2, y: 0 }, 1)).toEqual({ kind: "vertex", index: 0 });
  });

  it("scales the grab radius with zoom", () => {
    const justOutsideAtFullZoom = { x: HANDLE_GRAB_PX + 4, y: 0 };
    expect(hitLinearHandle(layout(), justOutsideAtFullZoom, 1)).toBeNull();
    expect(hitLinearHandle(layout(), justOutsideAtFullZoom, 0.25)).toEqual({ kind: "vertex", index: 0 });
  });

  it("widens the grab radius by the coarse-pointer multiplier — a touch miss for a mouse is still a grab", () => {
    const fingertipOffCentre = { x: HANDLE_GRAB_PX * 2 - 1, y: 0 };
    expect(hitLinearHandle(layout(), fingertipOffCentre, 1)).toBeNull(); // precise pointer: out of range
    expect(hitLinearHandle(layout(), fingertipOffCentre, 1, 2)).toEqual({ kind: "vertex", index: 0 });
    expect(hitLinearHandle(layout(), { x: HANDLE_GRAB_PX * 2 + 2, y: 0 }, 1, 2)).toBeNull(); // still bounded
  });
});

describe("elbow arrows offer no bend to insert", () => {
  /**
   * An elbow route is derived from the two endpoints, so a third vertex has nowhere to live: the
   * renderer ignores it, but it still counts toward the element's bounding box, and it would appear
   * as an unexplained bend if the arrow were later switched to straight or curved.
   */
  const elbow = () => createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], arrowType: "elbow" });

  it("offers no midpoint however near the pointer is", () => {
    expect(linearHandleLayout(elbow(), 1, { x: 100, y: 0 }).midpoint).toBeNull();
  });

  it("still offers both endpoint handles, which are the only thing there is to edit", () => {
    expect(linearHandleLayout(elbow(), 1, { x: 100, y: 0 }).vertices).toHaveLength(2);
  });

  it("has nothing for a pointer at the segment middle to grab", () => {
    const layout = linearHandleLayout(elbow(), 1, { x: 100, y: 0 });
    expect(hitLinearHandle(layout, { x: 100, y: 0 }, 1)).toBeNull();
  });
});
