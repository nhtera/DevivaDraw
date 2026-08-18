import { describe, expect, it } from "vitest";
import { Scene } from "../scene/scene";
import { createRectangleElement } from "../elements/shape-elements";
import { anchorForElementPoint, isOrphanedAnchor, resolveCommentAnchor } from "./comment-anchor";
import type { CommentAnchor } from "./comment-types";

/** A 100×50 box at (100, 100); the anchor under test sits at its centre-right quarter point. */
function sceneWithBox() {
  const scene = new Scene();
  const box = scene.addElement(createRectangleElement({ x: 100, y: 100, width: 100, height: 50 }));
  return { scene, box };
}

const closeTo = (point: { x: number; y: number }, x: number, y: number) => {
  expect(point.x).toBeCloseTo(x, 6);
  expect(point.y).toBeCloseTo(y, 6);
};

describe("anchorForElementPoint", () => {
  it("stores the click as a fraction of the unrotated box", () => {
    const { box } = sceneWithBox();
    const anchor = anchorForElementPoint(box, { x: 125, y: 140 });
    expect(anchor.kind).toBe("element");
    if (anchor.kind !== "element") throw new Error("expected an element anchor");
    expect(anchor.fx).toBeCloseTo(0.25, 6);
    expect(anchor.fy).toBeCloseTo(0.8, 6);
    expect(anchor.x).toBe(125);
    expect(anchor.y).toBe(140);
  });

  it("survives a degenerate zero-size box instead of dividing by zero", () => {
    const scene = new Scene();
    const line = scene.addElement(createRectangleElement({ x: 10, y: 10, width: 0, height: 0 }));
    const anchor = anchorForElementPoint(line, { x: 10, y: 10 });
    if (anchor.kind !== "element") throw new Error("expected an element anchor");
    expect(Number.isFinite(anchor.fx)).toBe(true);
    expect(Number.isFinite(anchor.fy)).toBe(true);
  });
});

describe("resolveCommentAnchor", () => {
  it("returns the stored point for a point anchor and null for a page anchor", () => {
    const { scene } = sceneWithBox();
    closeTo(resolveCommentAnchor({ kind: "point", x: 5, y: 7 }, scene)!, 5, 7);
    expect(resolveCommentAnchor({ kind: "page" }, scene)).toBeNull();
  });

  it("reproduces the clicked point exactly while the shape is untouched", () => {
    const { scene, box } = sceneWithBox();
    const anchor = anchorForElementPoint(box, { x: 125, y: 140 });
    closeTo(resolveCommentAnchor(anchor, scene)!, 125, 140);
  });

  it("tracks the shape through a move", () => {
    const { scene, box } = sceneWithBox();
    const anchor = anchorForElementPoint(box, { x: 125, y: 140 });
    scene.updateElement(box.id, { x: 300, y: 400 });
    closeTo(resolveCommentAnchor(anchor, scene)!, 325, 440);
  });

  it("tracks the shape through a resize", () => {
    const { scene, box } = sceneWithBox();
    const anchor = anchorForElementPoint(box, { x: 125, y: 140 });
    scene.updateElement(box.id, { width: 200, height: 100 });
    closeTo(resolveCommentAnchor(anchor, scene)!, 150, 180);
  });

  it("tracks the shape through a rotation that is not a right angle", () => {
    const { scene, box } = sceneWithBox();
    const anchor = anchorForElementPoint(box, { x: 125, y: 140 });
    const angle = (37 * Math.PI) / 180;
    scene.updateElement(box.id, { angle });

    // Expected: the same local point, rotated about the box centre by the box's own angle.
    const center = { x: 150, y: 125 };
    const dx = 125 - center.x;
    const dy = 140 - center.y;
    const expectedX = center.x + dx * Math.cos(angle) - dy * Math.sin(angle);
    const expectedY = center.y + dx * Math.sin(angle) + dy * Math.cos(angle);
    closeTo(resolveCommentAnchor(anchor, scene)!, expectedX, expectedY);
  });

  it("round-trips a click made on an already-rotated shape", () => {
    const { scene, box } = sceneWithBox();
    scene.updateElement(box.id, { angle: (37 * Math.PI) / 180 });
    const rotated = scene.getElement(box.id)!;
    const anchor = anchorForElementPoint(rotated, { x: 160, y: 130 });
    closeTo(resolveCommentAnchor(anchor, scene)!, 160, 130);
  });

  it("falls back to the last-known point when the shape is deleted, without rewriting the anchor", () => {
    const { scene, box } = sceneWithBox();
    const anchor: CommentAnchor = anchorForElementPoint(box, { x: 125, y: 140 });
    const before = JSON.stringify(anchor);
    scene.deleteElement(box.id);
    closeTo(resolveCommentAnchor(anchor, scene)!, 125, 140);
    expect(JSON.stringify(anchor)).toBe(before);
  });

  it("falls back when the shape has not arrived on this peer yet", () => {
    const scene = new Scene();
    closeTo(resolveCommentAnchor({ kind: "element", elementId: "not-here", fx: 0.5, fy: 0.5, x: 9, y: 9 }, scene)!, 9, 9);
  });
});

describe("isOrphanedAnchor", () => {
  it("is true only for an element anchor whose shape is gone", () => {
    const { scene, box } = sceneWithBox();
    const anchor = anchorForElementPoint(box, { x: 125, y: 140 });
    expect(isOrphanedAnchor(anchor, scene)).toBe(false);
    expect(isOrphanedAnchor({ kind: "point", x: 0, y: 0 }, scene)).toBe(false);
    scene.deleteElement(box.id);
    expect(isOrphanedAnchor(anchor, scene)).toBe(true);
  });
});
