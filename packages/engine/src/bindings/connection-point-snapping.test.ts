/**
 * Snapping an endpoint onto one of a shape's connection anchors, end to end: the `focus` solve and
 * the `previewBoundEndpoint` behaviour built on it.
 *
 * The property that matters is that a snap is *exact* — `recomputeBindingPoint` must reproduce the
 * anchor, not merely land near it. Where the endpoint actually *stays* is a separate matter, and one
 * `focus` cannot settle on its own: see `fixed-point-binding.test.ts` for the pin that holds it there.
 * The `focus` exercised here is what a reader without that pin falls back to, so it still has to put
 * the endpoint on the anchor for the geometry as it stood at bind time.
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

  it("keeps a usable focus even for an anchor focus cannot express, where the pin does the work", () => {
    // The endpoint still snaps here — `fixed-point-binding.test.ts` covers that it lands on the top
    // anchor — but no `focus` reproduces that anchor from due right, so the value stored beside the
    // pin can only describe the drop point. It must at least stay finite: it is what a reader with no
    // `fixedPoint` support falls back to, and NaN there would place the endpoint nowhere at all.
    const tall = createRectangleElement({ x: 0, y: 0, width: 100, height: 400 });
    const preview = previewBoundEndpoint(tall, { x: 50, y: 4 }, { x: 900, y: 200 }, SNAP);
    expect(preview).not.toBeNull();
    expect(Number.isFinite(preview!.focus)).toBe(true);
  });
});
