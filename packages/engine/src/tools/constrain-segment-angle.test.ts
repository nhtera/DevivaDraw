import { describe, expect, it } from "vitest";
import { constrainSegmentAngle } from "./constrain-segment-angle";

const anchor = { x: 100, y: 100 };

describe("constrainSegmentAngle", () => {
  it("returns the point unchanged when shift is not held", () => {
    const point = { x: 173, y: 141 }; // an arbitrary off-axis angle
    expect(constrainSegmentAngle(anchor, point, false)).toEqual(point);
  });

  it("snaps a near-horizontal drag to exactly horizontal", () => {
    const result = constrainSegmentAngle(anchor, { x: 200, y: 108 }, true);
    expect(result.x).toBeCloseTo(200.32, 1); // distance preserved (hypot(100,8) along 0°)
    expect(result.y).toBeCloseTo(100, 5);
  });

  it("snaps a near-vertical drag to exactly vertical", () => {
    const result = constrainSegmentAngle(anchor, { x: 106, y: 200 }, true);
    expect(result.x).toBeCloseTo(100, 5);
    expect(result.y).toBeCloseTo(200.18, 1);
  });

  it("snaps a near-diagonal drag to exactly 45 degrees", () => {
    const result = constrainSegmentAngle(anchor, { x: 190, y: 200 }, true);
    // 45° means equal x and y offset from the anchor.
    expect(result.x - anchor.x).toBeCloseTo(result.y - anchor.y, 5);
  });

  it("preserves the pointer's distance from the anchor", () => {
    const point = { x: 240, y: 170 };
    const raw = Math.hypot(point.x - anchor.x, point.y - anchor.y);
    const result = constrainSegmentAngle(anchor, point, true);
    expect(Math.hypot(result.x - anchor.x, result.y - anchor.y)).toBeCloseTo(raw, 5);
  });

  it("snaps to 15-degree increments (the step between horizontal and 45°)", () => {
    // A point at ~15° should land exactly on 15°.
    const rad = (15 * Math.PI) / 180;
    const point = { x: anchor.x + Math.cos(rad + 0.03) * 100, y: anchor.y + Math.sin(rad + 0.03) * 100 };
    const result = constrainSegmentAngle(anchor, point, true);
    const angle = Math.atan2(result.y - anchor.y, result.x - anchor.x);
    expect(angle).toBeCloseTo(rad, 5);
  });

  it("returns the point unchanged when it coincides with the anchor (no angle defined)", () => {
    expect(constrainSegmentAngle(anchor, { ...anchor }, true)).toEqual(anchor);
  });
});
