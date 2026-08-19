/**
 * Geometry, so tested as geometry: every case here is a rect layout with an arithmetically knowable
 * answer. Dragging shapes around in a browser to find out whether the maths is right is both slower
 * and less conclusive.
 */
import { describe, expect, it } from "vitest";
import { computeGapSnap } from "./snapping";
import type { SceneRect } from "../render/viewport-culling";

function rect(x: number, y: number, width = 100, height = 100): SceneRect {
  return { x, y, width, height };
}

const THRESHOLD = 8;

describe("computeGapSnap — between two neighbours", () => {
  it("equalises the gaps on either side of the moving rect", () => {
    // Neighbours at 0..100 and 400..500. Even spacing puts the moving rect's left edge at 200.
    const moving = rect(206, 0);
    const { dx, dy } = computeGapSnap(moving, [rect(0, 0), rect(400, 0)], THRESHOLD);

    expect(dx).toBeCloseTo(-6);
    expect(dy).toBe(0);
  });

  it("returns a guide per gap, each labelled with the distance the snap produced", () => {
    const { guides } = computeGapSnap(rect(206, 0), [rect(0, 0), rect(400, 0)], THRESHOLD);

    expect(guides).toHaveLength(2);
    expect(guides.every((guide) => guide.kind === "gap")).toBe(true);
    // 500 of free space split in two: 100 each side.
    expect(guides.map((guide) => guide.label)).toEqual(["100", "100"]);
    // A gap measured along x draws as a horizontal span.
    expect(guides.every((guide) => guide.orientation === "horizontal")).toBe(true);
    expect(guides[0]).toMatchObject({ from: 100, to: 200 });
    expect(guides[1]).toMatchObject({ from: 300, to: 400 });
  });

  it("does not fire when the correction is beyond the threshold", () => {
    // 40px from evenly spaced is a position the user chose, not one they were reaching for.
    expect(computeGapSnap(rect(240, 0), [rect(0, 0), rect(400, 0)], THRESHOLD).dx).toBe(0);
  });

  it("works on the vertical axis with the same arithmetic", () => {
    const { dx, dy, guides } = computeGapSnap(rect(0, 206), [rect(0, 0), rect(0, 400)], THRESHOLD);

    expect(dy).toBeCloseTo(-6);
    expect(dx).toBe(0);
    expect(guides.every((guide) => guide.orientation === "vertical")).toBe(true);
  });
});

describe("computeGapSnap — repeating a pair's spacing", () => {
  it("continues an evenly spaced row when the moving rect is dragged past its end", () => {
    // 0..100 and 200..300, a gap of 100. The next slot starts at 400.
    const { dx } = computeGapSnap(rect(405, 0), [rect(0, 0), rect(200, 0)], THRESHOLD);
    expect(dx).toBeCloseTo(-5);
  });

  it("continues the row in the other direction too", () => {
    // Pair at 200..300 and 400..500, gap 100. The slot before it ends at 100, so x = 0.
    const { dx } = computeGapSnap(rect(-4, 0), [rect(200, 0), rect(400, 0)], THRESHOLD);
    expect(dx).toBeCloseTo(4);
  });

  it("labels both the spacing it copied and the spacing it created", () => {
    const { guides } = computeGapSnap(rect(405, 0), [rect(0, 0), rect(200, 0)], THRESHOLD);
    expect(guides.map((guide) => guide.label)).toEqual(["100", "100"]);
  });
});

describe("computeGapSnap — when it must stay quiet", () => {
  it("ignores candidates that do not share a band on the other axis", () => {
    // Correctly spaced on x, but 900 units below: these three shapes are not a row.
    const result = computeGapSnap(rect(206, 900), [rect(0, 0), rect(400, 0)], THRESHOLD);
    expect(result).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("needs two neighbours — one shape is not a spacing", () => {
    expect(computeGapSnap(rect(206, 0), [rect(0, 0)], THRESHOLD)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("never proposes a group's internal spacing to an unrelated shape", () => {
    // A group of three tightly stacked shapes, collapsed by the caller into one rect (which is the
    // contract this relies on). Its members' 10px internal gaps must be invisible here: a shape
    // dragged near the group is aligning to the group, not to spacing inside it.
    const collapsedGroup = rect(0, 0, 320, 100);
    const other = rect(600, 0);

    const result = computeGapSnap(rect(400, 0), [collapsedGroup, other], THRESHOLD);

    // The only spacing on offer is group→moving and moving→other, which are 80 and 100 apart — well
    // beyond the threshold, so nothing fires. With per-element candidates the group's 10px gaps
    // would have been repeat candidates all over this drag.
    expect(result.guides).toEqual([]);
    expect(result.dx).toBe(0);
  });

  it("is unaffected by a candidate the moving rect overlaps on the spacing axis", () => {
    // An overlapping rect is neither before nor after: there is no gap to measure.
    const result = computeGapSnap(rect(206, 0), [rect(190, 0), rect(400, 0)], THRESHOLD);
    expect(result.dx).toBe(0);
  });
});

describe("computeGapSnap — choosing between candidates", () => {
  it("takes the smallest correction when several cases apply at once", () => {
    // Between 0..100 and 400..500 wants dx = -6; repeating the 0..100 / 200..300 pair is not
    // available here, so add a third shape making a nearer repeat slot.
    const { dx } = computeGapSnap(rect(206, 0), [rect(0, 0), rect(400, 0), rect(-300, 0)], THRESHOLD);
    // The between-case correction is the smaller one and stays.
    expect(dx).toBeCloseTo(-6);
  });

  it("measures against the neighbour whose facing edge is nearest, not the one that starts last", () => {
    // A wide backdrop 0..500 and a small shape 100..200 both sit entirely left of the mover. The
    // backdrop is by far the nearer of the two, but it *starts* first — ordering the candidates by
    // their start would hand the algorithm the small shape and measure the gap against the wrong
    // thing. Even spacing against the backdrop puts the mover's left edge at 600.
    const { dx } = computeGapSnap(rect(604, 0), [rect(0, 0, 500, 100), rect(100, 0), rect(800, 0)], THRESHOLD);
    expect(dx).toBeCloseTo(-4);
  });

  it("prefers the nearest neighbour on each side, not the farthest", () => {
    // 0..100 (far) and 150..250 (near) on the left; the near one defines the gap being matched.
    const { dx } = computeGapSnap(rect(400, 0), [rect(0, 0), rect(150, 0), rect(600, 0)], THRESHOLD);
    // gapBefore = 400-250 = 150, gapAfter = 600-500 = 100 → correction (100-150)/2 = -25, over
    // threshold, so no between-snap; the repeat cases are farther still.
    expect(dx).toBe(0);
  });
});
