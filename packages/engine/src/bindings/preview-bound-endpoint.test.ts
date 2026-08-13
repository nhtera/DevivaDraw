import { describe, expect, it } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { createEllipseElement, createRectangleElement } from "../elements/shape-elements";
import { bindingGapFor } from "./binding-thresholds";
import { isBindingSuppressed, previewBoundEndpoint } from "./preview-bound-endpoint";
import { recomputeBindingPoint } from "./recompute-binding";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

describe("isBindingSuppressed", () => {
  it("is held by ctrl or cmd, and by nothing else", () => {
    expect(isBindingSuppressed(NO_MODIFIERS)).toBe(false);
    expect(isBindingSuppressed({ ...NO_MODIFIERS, ctrl: true })).toBe(true);
    expect(isBindingSuppressed({ ...NO_MODIFIERS, meta: true })).toBe(true);
    // shift already means axis-constrain, alt already means duplicate — neither may suppress binding.
    expect(isBindingSuppressed({ ...NO_MODIFIERS, shift: true })).toBe(false);
    expect(isBindingSuppressed({ ...NO_MODIFIERS, alt: true })).toBe(false);
  });
});

describe("previewBoundEndpoint", () => {
  const rect = createRectangleElement({ x: 0, y: 0, width: 100, height: 100 });

  it("clips the endpoint to the outline and pushes it clear of the stroke", () => {
    const preview = previewBoundEndpoint(rect, { x: 95, y: 50 }, { x: 400, y: 50 })!;
    expect(preview.point.x).toBeCloseTo(100 + bindingGapFor(rect));
    expect(preview.point.y).toBeCloseTo(50);
    expect(preview.gap).toBe(bindingGapFor(rect));
  });

  it("returns binding fields that reproduce the previewed point exactly", () => {
    // This is the guarantee the whole module exists for: the preview a drag shows and the binding a
    // release commits are the same numbers, so releasing never nudges the endpoint.
    const reference = { x: 400, y: 20 };
    const preview = previewBoundEndpoint(rect, { x: 95, y: 80 }, reference)!;
    const committed = recomputeBindingPoint(rect.type, rect, { focus: preview.focus, gap: preview.gap }, reference);

    expect(committed.x).toBeCloseTo(preview.point.x, 6);
    expect(committed.y).toBeCloseTo(preview.point.y, 6);
  });

  it("derives a different focus for a different drop point on the same shape", () => {
    const reference = { x: 400, y: 50 };
    const high = previewBoundEndpoint(rect, { x: 95, y: 10 }, reference)!;
    const low = previewBoundEndpoint(rect, { x: 95, y: 90 }, reference)!;
    expect(high.focus).not.toBeCloseTo(low.focus);
  });

  it("takes the gap from the target's own stroke width", () => {
    const thick = createRectangleElement({ x: 0, y: 0, width: 100, height: 100, strokeWidth: 8 });
    expect(previewBoundEndpoint(thick, { x: 95, y: 50 }, { x: 400, y: 50 })!.gap).toBe(bindingGapFor(thick));
  });

  it("follows the target's own outline kind", () => {
    const ellipse = createEllipseElement({ x: 0, y: 0, width: 100, height: 100 });
    const preview = previewBoundEndpoint(ellipse, { x: 95, y: 50 }, { x: 400, y: 50 })!;
    expect(preview.point.x).toBeCloseTo(100 + bindingGapFor(ellipse));
  });

  it("returns null for a target with no outline to bind against", () => {
    const arrow = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
    expect(previewBoundEndpoint(arrow, { x: 5, y: 5 }, { x: 100, y: 100 })).toBeNull();
  });
});
