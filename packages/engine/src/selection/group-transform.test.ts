import { describe, expect, it } from "vitest";
import { mapBoundsToGroup, rotateElementsAroundPivot, selectionBoundsOf, translateElements } from "./group-transform";

describe("selectionBoundsOf", () => {
  it("union bbox of multiple unrotated elements", () => {
    const bounds = selectionBoundsOf([
      { x: 0, y: 0, width: 10, height: 10, angle: 0, isDeleted: false },
      { x: 20, y: 30, width: 5, height: 5, angle: 0, isDeleted: false },
    ]);
    expect(bounds).toEqual({ x: 0, y: 0, width: 25, height: 35 });
  });

  it("ignores soft-deleted members and returns null when nothing remains", () => {
    expect(selectionBoundsOf([{ x: 0, y: 0, width: 10, height: 10, angle: 0, isDeleted: true }])).toBeNull();
  });

  it("accounts for a rotated member's true footprint, not its raw unrotated bbox", () => {
    // A 40x4 sliver rotated 90deg around its own center spans ~4 wide x ~40 tall.
    const bounds = selectionBoundsOf([{ x: 0, y: 18, width: 40, height: 4, angle: Math.PI / 2, isDeleted: false }]);
    expect(bounds?.width).toBeCloseTo(4, 5);
    expect(bounds?.height).toBeCloseTo(40, 5);
  });
});

describe("translateElements", () => {
  it("shifts every element's x/y by the same delta", () => {
    const result = translateElements([{ id: "a", x: 0, y: 0, width: 10, height: 10, angle: 0 }], 5, -3);
    expect(result).toEqual([{ id: "a", changes: { x: 5, y: -3 } }]);
  });
});

describe("mapBoundsToGroup", () => {
  it("maps a member's proportional position/size from the old group box into the new one", () => {
    const oldGroup = { x: 0, y: 0, width: 100, height: 100 };
    const newGroup = { x: 0, y: 0, width: 200, height: 50 }; // 2x wider, 0.5x tall
    const memberOldBounds = { x: 10, y: 10, width: 20, height: 20 }; // sits at 10% in from the group's top-left
    const mapped = mapBoundsToGroup(memberOldBounds, oldGroup, newGroup);
    expect(mapped).toEqual({ x: 20, y: 5, width: 40, height: 10 });
  });

  it("a member exactly at the group bounds maps 1:1 to the new group bounds", () => {
    const group = { x: 0, y: 0, width: 100, height: 100 };
    const newGroup = { x: 50, y: 50, width: 40, height: 40 };
    expect(mapBoundsToGroup(group, group, newGroup)).toEqual(newGroup);
  });

  it("degenerate zero-width/height old group falls back to scale 1 (no division by zero)", () => {
    const oldGroup = { x: 0, y: 0, width: 0, height: 0 };
    const newGroup = { x: 10, y: 10, width: 50, height: 50 };
    const mapped = mapBoundsToGroup({ x: 0, y: 0, width: 5, height: 5 }, oldGroup, newGroup);
    expect(mapped).toEqual({ x: 10, y: 10, width: 5, height: 5 });
  });
});

describe("rotateElementsAroundPivot", () => {
  it("single element rotated around its own center: position unchanged, angle accumulates", () => {
    const element = { id: "a", x: 0, y: 0, width: 10, height: 10, angle: 0 };
    const pivot = { x: 5, y: 5 }; // the element's own center
    const [result] = rotateElementsAroundPivot([element], pivot, Math.PI / 2);
    expect(result?.changes.x).toBeCloseTo(0, 5);
    expect(result?.changes.y).toBeCloseTo(0, 5);
    expect(result?.changes.angle).toBeCloseTo(Math.PI / 2, 5);
  });

  it("orbits a group member's center around a shared pivot elsewhere in the group", () => {
    // Element centered at (15, 5); pivot at (5, 5); a 90deg rotation should orbit its center to (5, 15).
    const element = { id: "a", x: 10, y: 0, width: 10, height: 10, angle: 0 };
    const [result] = rotateElementsAroundPivot([element], { x: 5, y: 5 }, Math.PI / 2);
    // new center = (5, 15) -> new x = center.x - width/2 = 0, new y = center.y - height/2 = 10
    expect(result?.changes.x).toBeCloseTo(0, 5);
    expect(result?.changes.y).toBeCloseTo(10, 5);
    expect(result?.changes.angle).toBeCloseTo(Math.PI / 2, 5);
  });

  it("compound rotation: a pre-rotated child inside a group that itself gets rotated accumulates both", () => {
    // Known failure mode in naive clone implementations: rotating a group twice must not reset a
    // member's own prior rotation, it must add to it.
    const element = { id: "a", x: 0, y: 0, width: 10, height: 10, angle: Math.PI / 4 }; // already 45deg
    const pivot = { x: 5, y: 5 }; // its own center — isolates the angle-accumulation check from orbit math
    const [result] = rotateElementsAroundPivot([element], pivot, Math.PI / 4); // group rotates another 45deg
    expect(result?.changes.angle).toBeCloseTo(Math.PI / 2, 5); // 45 + 45 = 90deg total, not reset to 45
  });

  it("normalizes accumulated angle into [0, 2*PI)", () => {
    const element = { id: "a", x: 0, y: 0, width: 10, height: 10, angle: (3 * Math.PI) / 2 };
    const [result] = rotateElementsAroundPivot([element], { x: 5, y: 5 }, Math.PI);
    expect(result?.changes.angle).toBeCloseTo(Math.PI / 2, 5); // 270 + 180 = 450 -> wraps to 90deg
  });
});
