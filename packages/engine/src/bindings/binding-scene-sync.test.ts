import { describe, expect, it, vi } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { createNoteElement } from "../elements/note-element";
import { createRectangleElement, createStarElement } from "../elements/shape-elements";
import type { TextElement } from "../elements/text-element";
import { Scene } from "../scene/scene";
import { createFixedWidthTextMeasurer } from "../text/text-measurement";
import { getOrCreateArrowLabel } from "./arrow-label";
import { bindArrowEndpoint } from "./binding-model";
import { findBindableShapeNear, registerArrowBindingHooks, rerouteArrowEndpoints } from "./binding-scene-sync";

function setup() {
  const scene = new Scene();
  const shapeA = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
  const shapeB = scene.addElement(createRectangleElement({ x: 300, y: 0, width: 100, height: 50 }));
  const arrow = scene.addElement(createArrowElement({ x: 100, y: 25, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] }));
  return { scene, shapeA, shapeB, arrow };
}

describe("findBindableShapeNear", () => {
  it("finds a rectangle whose expanded bbox contains the point", () => {
    const { scene, shapeA } = setup();
    expect(findBindableShapeNear(scene, { x: 50, y: 25 }, 5)?.id).toBe(shapeA.id);
    expect(findBindableShapeNear(scene, { x: 105, y: 25 }, 10)?.id).toBe(shapeA.id); // just outside, within threshold
  });

  it("returns null when nothing is near", () => {
    const { scene } = setup();
    expect(findBindableShapeNear(scene, { x: 5000, y: 5000 }, 10)).toBeNull();
  });

  it("offers a sticky note like any other closed shape", () => {
    const scene = new Scene();
    const note = scene.addElement(createNoteElement({ x: 0, y: 0, width: 100, height: 100 }));
    expect(findBindableShapeNear(scene, { x: 50, y: 50 }, 5)?.id).toBe(note.id);
    expect(findBindableShapeNear(scene, { x: 103, y: 50 }, 5)?.id).toBe(note.id); // just outside, within threshold
  });

  it("measures against the real outline, so a star's notch is not grabbable where its bounding box is", () => {
    const scene = new Scene();
    const star = scene.addElement(createStarElement({ x: 0, y: 0, width: 100, height: 100 }));
    // The bbox corner is far from a star's actual outline; its top point is right there.
    expect(findBindableShapeNear(scene, { x: 50, y: -4 }, 5)?.id).toBe(star.id);
    expect(findBindableShapeNear(scene, { x: 2, y: 2 }, 5)).toBeNull();
  });

  it("counts a point inside the shape, not only one near its edge", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 400, height: 400 }));
    // Dead centre of a large shape is nowhere near the outline, but is unambiguously aimed at it.
    expect(findBindableShapeNear(scene, { x: 200, y: 200 }, 5)?.id).toBe(rect.id);
  });

  it("ignores deleted shapes and the topmost (last z-order) shape wins on overlap", () => {
    const scene = new Scene();
    const back = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));
    const front = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));
    expect(findBindableShapeNear(scene, { x: 50, y: 50 }, 0)?.id).toBe(front.id);

    scene.deleteElement(front.id);
    expect(findBindableShapeNear(scene, { x: 50, y: 50 }, 0)?.id).toBe(back.id);
  });
});

describe("rerouteArrowEndpoints", () => {
  it("recomputes the bound end's position when the shape moves, leaving the unbound end untouched", () => {
    const { scene, shapeA, arrow } = setup();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 0 });

    const moved = scene.updateElement(shapeA.id, { x: 500, y: 500 });
    rerouteArrowEndpoints(scene, arrow.id, moved!);

    const updated = scene.getElement(arrow.id);
    expect(updated?.type).toBe("arrow");
    if (updated?.type !== "arrow") return;
    const startAbsolute = { x: updated.x + updated.points[0]!.x, y: updated.y + updated.points[0]!.y };
    const endAbsolute = { x: updated.x + updated.points[updated.points.length - 1]!.x, y: updated.y + updated.points[updated.points.length - 1]!.y };
    // Start should now sit on the moved shape's border, near its new position (500-600, 500-550).
    expect(startAbsolute.x).toBeGreaterThan(400);
    expect(startAbsolute.y).toBeGreaterThan(400);
    // The unbound end (originally at (300,25)) stays put.
    expect(endAbsolute).toEqual({ x: 300, y: 25 });
  });

  it("recomputes BOTH ends independently for a self-loop arrow (start and end bound to the same shape)", () => {
    const { scene, shapeA, arrow } = setup();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 0 });
    bindArrowEndpoint(scene, arrow.id, "end", shapeA.id, { focus: 0.4, gap: 0 });

    const moved = scene.updateElement(shapeA.id, { x: 1000, y: 1000 });
    expect(() => rerouteArrowEndpoints(scene, arrow.id, moved!)).not.toThrow();

    const updated = scene.getElement(arrow.id);
    expect(updated?.type).toBe("arrow");
    if (updated?.type !== "arrow") return;
    const points = updated.points.map((p) => ({ x: updated.x + p.x, y: updated.y + p.y }));
    // Both endpoints must land near the shape's new position (center around (1050, 1025)).
    for (const point of [points[0]!, points[points.length - 1]!]) {
      expect(point.x).toBeGreaterThan(900);
      expect(point.y).toBeGreaterThan(900);
    }
    // The two endpoints are distinct (different focus values produced different attachment points).
    expect(points[0]).not.toEqual(points[points.length - 1]);
  });

  it("is a no-op for an arrow not bound to the given shape", () => {
    const { scene, shapeB, arrow } = setup();
    const before = scene.getElement(arrow.id);
    rerouteArrowEndpoints(scene, arrow.id, shapeB);
    expect(scene.getElement(arrow.id)).toEqual(before);
  });

  it("does not touch the bound arrow when the container's geometry hasn't actually changed (e.g. a color-only edit) — regression guard against reroute-amplification", () => {
    const { scene, shapeA, arrow } = setup();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 0 });
    const arrowBefore = scene.getElement(arrow.id)!;

    const recolored = scene.updateElement(shapeA.id, { strokeColor: "#ff0000" })!;
    rerouteArrowEndpoints(scene, arrow.id, recolored);

    expect(scene.getElement(arrow.id)).toEqual(arrowBefore);
    expect(scene.getElement(arrow.id)!.version).toBe(arrowBefore.version);
  });

  it("still reroutes when the container actually moves, even by a tiny amount above the unchanged-epsilon", () => {
    const { scene, shapeA, arrow } = setup();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 0 });
    const arrowBefore = scene.getElement(arrow.id)!;

    const moved = scene.updateElement(shapeA.id, { x: shapeA.x + 1, y: shapeA.y })!;
    rerouteArrowEndpoints(scene, arrow.id, moved);

    expect(scene.getElement(arrow.id)!.version).toBeGreaterThan(arrowBefore.version);
  });
});

describe("registerArrowBindingHooks", () => {
  it("reroutes a bound arrow automatically when its shape is moved via Scene.updateElement", () => {
    const { scene, shapeA, arrow } = setup();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 0 });
    registerArrowBindingHooks(scene);

    scene.updateElement(shapeA.id, { x: 700, y: 700 });

    const updated = scene.getElement(arrow.id);
    if (updated?.type === "arrow") {
      const startAbsolute = { x: updated.x + updated.points[0]!.x, y: updated.y + updated.points[0]!.y };
      expect(startAbsolute.x).toBeGreaterThan(600);
      expect(startAbsolute.y).toBeGreaterThan(600);
    }
  });

  it("clears the binding automatically when the bound shape is soft-deleted, arrow survives", () => {
    const { scene, shapeA, arrow } = setup();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 0 });
    registerArrowBindingHooks(scene);

    scene.deleteElement(shapeA.id);

    const updated = scene.getElement(arrow.id);
    expect(updated?.isDeleted).toBe(false);
    if (updated?.type === "arrow") expect(updated.startBinding).toBeNull();
  });

  it("does not recurse or loop: rerouting the arrow itself never re-triggers the shape-reroute branch", () => {
    const { scene, shapeA, arrow } = setup();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 0 });
    const hookSpy = vi.fn();
    scene.registerUpdateHook(hookSpy);
    registerArrowBindingHooks(scene);

    scene.updateElement(shapeA.id, { x: 900, y: 900 });

    // Exactly 2 updateElement calls happen: the shape's own move, and the one reroute of the bound
    // arrow — never an unbounded chain.
    expect(hookSpy).toHaveBeenCalledTimes(2);
  });

  it("a color-only container edit through the live hook never re-touches (or rebroadcasts) bound arrows", () => {
    const { scene, shapeA, arrow } = setup();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 0 });
    const arrowBefore = scene.getElement(arrow.id)!;
    const hookSpy = vi.fn();
    scene.registerUpdateHook(hookSpy);
    registerArrowBindingHooks(scene);

    scene.updateElement(shapeA.id, { strokeColor: "#00ff00" });

    expect(scene.getElement(arrow.id)).toEqual(arrowBefore);
    // Only the shape's own update ran through the hook set — no cascading arrow reroute/rebroadcast.
    expect(hookSpy).toHaveBeenCalledTimes(1);
  });

  it("unregistering the hook stops further reroutes", () => {
    const { scene, shapeA, arrow } = setup();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 0 });
    const unregister = registerArrowBindingHooks(scene);
    unregister();

    scene.updateElement(shapeA.id, { x: 900, y: 900 });

    const updated = scene.getElement(arrow.id);
    if (updated?.type === "arrow") expect(updated.x).toBe(100); // unchanged from setup()
  });

  it("re-centers a bound arrow label after the arrow's own geometry changes, when a measurer is supplied", () => {
    const { scene, shapeA, arrow } = setup();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 0 });
    const { textElementId } = getOrCreateArrowLabel(scene, arrow.id);
    scene.updateElement(textElementId, { text: "hello" } as Partial<TextElement>);
    const labelBefore = scene.getElement(textElementId);

    registerArrowBindingHooks(scene, createFixedWidthTextMeasurer(6));
    scene.updateElement(shapeA.id, { x: 900, y: 900 }); // triggers a reroute, which changes the arrow's geometry

    const labelAfter = scene.getElement(textElementId);
    expect(labelAfter?.updated).toBeGreaterThanOrEqual(labelBefore!.updated);
    expect(labelAfter).not.toEqual(labelBefore); // position/version changed
  });

  it("without a measurer, arrow geometry changes still work but the label is left untouched", () => {
    const { scene, shapeA, arrow } = setup();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 0 });
    const { textElementId } = getOrCreateArrowLabel(scene, arrow.id);
    const labelBefore = scene.getElement(textElementId);

    registerArrowBindingHooks(scene); // no measurer
    scene.updateElement(shapeA.id, { x: 900, y: 900 });

    expect(scene.getElement(textElementId)).toEqual(labelBefore);
  });
});
