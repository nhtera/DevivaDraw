/**
 * An endpoint snapped to a connection anchor stays on that anchor.
 *
 * This is the property `focus` alone cannot provide, and the reason `ArrowBinding.fixedPoint` exists.
 * `focus` is measured perpendicular to the direction of the arrow's *other* end, so the stored value
 * that lands on the right-edge midpoint today resolves somewhere else on the outline as soon as
 * either end moves — measured live before this was added, dropping an endpoint exactly on a dot and
 * then dragging the shape down slid it 17.7px off the dot. Excalidraw pins its elbow connectors the
 * same way (`fixedPoint: [1, 0.5001]`) and, measured in the identical scenario, holds to within 0.1px
 * while its focus-bound straight arrows drift 20.7px.
 */
import { describe, expect, it } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { createEllipseElement, createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { bindArrowEndpoint } from "./binding-model";
import { registerArrowBindingHooks } from "./binding-scene-sync";
import { previewBoundEndpoint } from "./preview-bound-endpoint";
import { recomputeBindingPoint } from "./recompute-binding";
import { shapeConnectionPoints } from "./shape-connection-points";

const SNAP = 12;
/** Up and to the right — deliberately not axis-aligned, so nothing passes by symmetry. */
const REFERENCE = { x: 500, y: -200 };

function box() {
  return createRectangleElement({ x: 0, y: 0, width: 200, height: 100 });
}

/** The middle of the box's right edge, which every anchor test here aims at. */
function rightAnchorOf(shape: ReturnType<typeof box>) {
  return shapeConnectionPoints(shape)[1]!;
}

describe("snapping to an anchor pins the endpoint to the shape", () => {
  it("reports the anchor in the shape's own frame, ready to store", () => {
    const preview = previewBoundEndpoint(box(), { x: 198, y: 54 }, REFERENCE, SNAP)!;
    expect(preview.fixedPoint).toEqual([1, 0.5]);
  });

  it("reports no anchor for an endpoint dropped between them", () => {
    const preview = previewBoundEndpoint(box(), { x: 200, y: 85 }, REFERENCE, SNAP)!;
    expect(preview.fixedPoint).toBeNull();
  });

  it("reports none at all without a snap radius, so a free-form binding is unaffected", () => {
    expect(previewBoundEndpoint(box(), { x: 200, y: 51 }, REFERENCE)!.fixedPoint).toBeNull();
  });

  it("still keeps a focus that reproduces the same anchor, for a reader that ignores the pin", () => {
    const shape = box();
    const preview = previewBoundEndpoint(shape, { x: 198, y: 54 }, REFERENCE, SNAP)!;
    const viaFocus = recomputeBindingPoint("rectangle", shape, { focus: preview.focus, gap: 0 }, REFERENCE);
    expect(viaFocus.x).toBeCloseTo(rightAnchorOf(shape).x, 6);
    expect(viaFocus.y).toBeCloseTo(rightAnchorOf(shape).y, 6);
  });

  it("snaps to an anchor focus cannot express at all, instead of declining", () => {
    // Approaching a tall box from due right, its top anchor is ninety degrees off the reference
    // direction — unreachable by a perpendicular nudge however large, so `focusForConnectionPoint`
    // returns null. The dot is drawn there regardless, so it has to be snappable.
    const tall = createRectangleElement({ x: 0, y: 0, width: 100, height: 400 });
    const preview = previewBoundEndpoint(tall, { x: 52, y: 3 }, { x: 900, y: 200 }, SNAP)!;
    expect(preview.fixedPoint).toEqual([0.5, 0]);
    expect(preview.point.x).toBeCloseTo(50, 6);
    expect(preview.point.y).toBeLessThan(0); // above the top edge by the gap
  });
});

describe("a pinned endpoint holds still", () => {
  const pinned = { focus: 0, gap: 0, fixedPoint: [1, 0.5] as const };

  it("ignores the direction of the arrow's other end entirely", () => {
    const shape = box();
    const fromTheRight = recomputeBindingPoint("rectangle", shape, pinned, { x: 900, y: 50 });
    const fromBelowLeft = recomputeBindingPoint("rectangle", shape, pinned, { x: -400, y: 900 });
    expect(fromTheRight).toEqual(fromBelowLeft);
    expect(fromTheRight).toEqual(rightAnchorOf(shape));
  });

  it("travels with the shape, one for one", () => {
    const moved = { ...box(), x: 320, y: -75 };
    expect(recomputeBindingPoint("rectangle", moved, pinned, REFERENCE)).toEqual(rightAnchorOf(moved));
  });

  it("stays on the same edge through a resize rather than sliding along it", () => {
    const resized = { ...box(), width: 640, height: 30 };
    expect(recomputeBindingPoint("rectangle", resized, pinned, REFERENCE)).toEqual(rightAnchorOf(resized));
  });

  it("rotates with the shape", () => {
    const turned = { ...box(), angle: Math.PI / 3 };
    const landed = recomputeBindingPoint("rectangle", turned, pinned, REFERENCE);
    expect(landed.x).toBeCloseTo(rightAnchorOf(turned).x, 6);
    expect(landed.y).toBeCloseTo(rightAnchorOf(turned).y, 6);
  });

  it("applies the gap straight out from the edge it is pinned to", () => {
    const landed = recomputeBindingPoint("rectangle", box(), { ...pinned, gap: 8 }, REFERENCE);
    expect(landed).toEqual({ x: 208, y: 50 });
  });

  it("holds on an ellipse too, where the anchor is the curve's own extreme", () => {
    const ellipse = createEllipseElement({ x: 0, y: 0, width: 160, height: 100 });
    const landed = recomputeBindingPoint("ellipse", ellipse, pinned, { x: -500, y: 500 });
    expect(landed).toEqual(shapeConnectionPoints(ellipse)[1]!);
  });
});

describe("through a live scene", () => {
  /** A box with an arrow pinned to its right edge, drawn away to the upper right. */
  function setup() {
    const scene = new Scene();
    registerArrowBindingHooks(scene);
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 200, height: 100 }));
    const arrow = scene.addElement(createArrowElement({ x: 200, y: 50, points: [{ x: 0, y: 0 }, { x: 300, y: -250 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shape.id, { focus: 0.93, gap: 0, fixedPoint: [1, 0.5] });
    return { scene, shapeId: shape.id, arrowId: arrow.id };
  }

  function startOf(scene: Scene, arrowId: string) {
    const arrow = scene.getElement(arrowId);
    if (arrow?.type !== "arrow") throw new Error("not an arrow");
    return { x: arrow.x + arrow.points[0]!.x, y: arrow.y + arrow.points[0]!.y };
  }

  it("keeps the endpoint on the anchor when the shape is dragged", () => {
    const { scene, shapeId, arrowId } = setup();
    scene.updateElement(shapeId, { x: -150, y: 260 });
    expect(startOf(scene, arrowId)).toEqual({ x: 50, y: 310 }); // the moved box's right-edge middle
  });

  it("keeps it there when the shape is resized under it", () => {
    const { scene, shapeId, arrowId } = setup();
    scene.updateElement(shapeId, { width: 60, height: 400 });
    expect(startOf(scene, arrowId)).toEqual({ x: 60, y: 200 });
  });

  it("lets go of the pin when the endpoint is re-bound somewhere else on the shape", () => {
    // `bindArrowEndpoint` writes a whole binding rather than merging into the old one, which is what
    // makes dragging a pinned endpoint off its dot actually release it.
    const { scene, shapeId, arrowId } = setup();
    bindArrowEndpoint(scene, arrowId, "start", shapeId, { focus: 0.2, gap: 0, fixedPoint: null });

    const arrow = scene.getElement(arrowId);
    if (arrow?.type !== "arrow") throw new Error("not an arrow");
    expect(arrow.startBinding?.fixedPoint).toBeNull();
    scene.updateElement(shapeId, { x: -150, y: 260 });
    expect(startOf(scene, arrowId)).not.toEqual({ x: 50, y: 310 });
  });
});
