/**
 * Snapping an endpoint onto one of a shape's connection anchors, end to end: the `focus` solve and
 * the `previewBoundEndpoint` behaviour built on it.
 *
 * The property that matters is that a snap is *exact* — `recomputeBindingPoint` must reproduce the
 * anchor, not merely land near it — because the binding is re-derived from `focus` every time the
 * shape moves. A snap that was only approximate would drift a little further from the dot each time
 * the target was nudged.
 */
import { describe, expect, it } from "vitest";
import { createEllipseElement, createRectangleElement } from "../elements/shape-elements";
import { previewBoundEndpoint } from "./preview-bound-endpoint";
import { focusForConnectionPoint, recomputeBindingPoint } from "./recompute-binding";
import { shapeConnectionPoints } from "./shape-connection-points";

const SNAP = 12;

describe("focusForConnectionPoint", () => {
  it("solves a focus that puts the endpoint exactly on the anchor", () => {
    const rect = createRectangleElement({ x: 0, y: 0, width: 200, height: 100 });
    const reference = { x: 400, y: 20 }; // up and to the right, so the aim is nowhere near axis-aligned
    const anchor = shapeConnectionPoints(rect)[1]!; // right edge middle

    const focus = focusForConnectionPoint("rectangle", rect, reference, anchor);
    expect(focus).not.toBeNull();

    const landed = recomputeBindingPoint("rectangle", rect, { focus: focus!, gap: 0 }, reference);
    expect(landed.x).toBeCloseTo(anchor.x, 6);
    expect(landed.y).toBeCloseTo(anchor.y, 6);
  });

  it("solves exactly for an ellipse too, where the outline is a curve rather than four edges", () => {
    const ellipse = createEllipseElement({ x: 0, y: 0, width: 160, height: 100 });
    const reference = { x: 120, y: 300 }; // below and a little to the right
    const anchor = shapeConnectionPoints(ellipse)[2]!; // bottom — the one that approach is aimed at

    const focus = focusForConnectionPoint("ellipse", ellipse, reference, anchor);
    expect(focus).not.toBeNull();

    const landed = recomputeBindingPoint("ellipse", ellipse, { focus: focus!, gap: 0 }, reference);
    expect(landed.x).toBeCloseTo(anchor.x, 4);
    expect(landed.y).toBeCloseTo(anchor.y, 4);
  });

  it("still solves exactly for an oblique approach needing a focus above one, which a fixed cap would refuse", () => {
    // Approaching a wide ellipse from the lower right and aiming at its bottom anchor needs a nudge
    // of roughly two half-extents. Reachability is decided by where the solve actually lands, not by
    // a magnitude limit — the dots would otherwise be drawn on shapes that decline to snap to them.
    const ellipse = createEllipseElement({ x: 0, y: 0, width: 160, height: 100 });
    const bottom = shapeConnectionPoints(ellipse)[2]!;
    const reference = { x: 300, y: 200 };

    const focus = focusForConnectionPoint("ellipse", ellipse, reference, bottom);
    expect(Math.abs(focus!)).toBeGreaterThan(1);

    const landed = recomputeBindingPoint("ellipse", ellipse, { focus: focus!, gap: 0 }, reference);
    expect(landed.x).toBeCloseTo(bottom.x, 4);
    expect(landed.y).toBeCloseTo(bottom.y, 4);
  });

  it("solves for a wide flat box approached diagonally — the shape a fixed cap failed on most often", () => {
    const wide = createRectangleElement({ x: 0, y: 0, width: 300, height: 100 });
    const reference = { x: -120, y: 320 }; // below and to the left, well off perpendicular
    const left = shapeConnectionPoints(wide)[3]!;

    const focus = focusForConnectionPoint("rectangle", wide, reference, left);
    const landed = recomputeBindingPoint("rectangle", wide, { focus: focus!, gap: 0 }, reference);
    expect(landed.x).toBeCloseTo(left.x, 4);
    expect(landed.y).toBeCloseTo(left.y, 4);
  });

  it("declines an anchor the model cannot reach from this direction rather than returning a wild focus", () => {
    // `focus` slides the endpoint perpendicular to the reference direction, so it only ever reaches
    // the half of the outline facing the arrow's other end. Approaching from due right, the top
    // anchor of a tall box is ninety degrees away and simply unreachable.
    const rect = createRectangleElement({ x: 0, y: 0, width: 100, height: 400 });
    const reference = { x: 900, y: 200 }; // dead level with the centre
    const top = shapeConnectionPoints(rect)[0]!;
    expect(focusForConnectionPoint("rectangle", rect, reference, top)).toBeNull();
  });

  it("declines the anchor on the far side, which is collinear but points the wrong way", () => {
    const rect = createRectangleElement({ x: 0, y: 0, width: 100, height: 100 });
    const reference = { x: 500, y: 50 };
    const left = shapeConnectionPoints(rect)[3]!; // directly behind the shape from here
    expect(focusForConnectionPoint("rectangle", rect, reference, left)).toBeNull();
  });
});

describe("previewBoundEndpoint — anchor snapping", () => {
  const rect = createRectangleElement({ x: 0, y: 0, width: 200, height: 100 });
  const reference = { x: 500, y: 50 };
  const rightAnchor = { x: 200, y: 50 };

  it("pulls an endpoint released near an anchor onto it", () => {
    const preview = previewBoundEndpoint(rect, { x: 198, y: 58 }, reference, SNAP)!;
    // The gap pushes the tip clear of the outline along the outward direction, so compare the
    // un-gapped landing point rather than the drawn one.
    const landed = recomputeBindingPoint("rectangle", rect, { focus: preview.focus, gap: 0 }, reference);
    expect(landed.x).toBeCloseTo(rightAnchor.x, 6);
    expect(landed.y).toBeCloseTo(rightAnchor.y, 6);
  });

  it("leaves an endpoint released between anchors exactly where the user put it", () => {
    const dropped = { x: 200, y: 85 }; // on the right edge, well below its middle
    const preview = previewBoundEndpoint(rect, dropped, reference, SNAP)!;
    const landed = recomputeBindingPoint("rectangle", rect, { focus: preview.focus, gap: 0 }, reference);
    expect(landed.y).toBeCloseTo(dropped.y, 6);
  });

  it("does not snap at all without a radius, so every existing caller keeps its free-form binding", () => {
    const dropped = { x: 200, y: 56 };
    const preview = previewBoundEndpoint(rect, dropped, reference)!;
    const landed = recomputeBindingPoint("rectangle", rect, { focus: preview.focus, gap: 0 }, reference);
    expect(landed.y).toBeCloseTo(dropped.y, 6);
  });

  it("falls back to the raw drop point when the nearest anchor is unreachable, rather than refusing to bind", () => {
    const tall = createRectangleElement({ x: 0, y: 0, width: 100, height: 400 });
    const fromTheRight = { x: 900, y: 200 };
    // Right beside the unreachable top anchor.
    const preview = previewBoundEndpoint(tall, { x: 50, y: 4 }, fromTheRight, SNAP);
    expect(preview).not.toBeNull();
    expect(Number.isFinite(preview!.focus)).toBe(true);
  });
});
