import { describe, expect, it } from "vitest";
import { createGenericElement } from "../elements/element-types";
import { Scene } from "../scene/scene";
import type { Camera } from "./camera";
import { createCamera } from "./camera";
import { elementIntersectsRect, filterVisibleElements, getVisibleElements, getVisibleSceneRect } from "./viewport-culling";
import type { SceneRect } from "./viewport-culling";

describe("getVisibleSceneRect", () => {
  it("identity camera at a 800x600 viewport covers scene (0,0)-(800,600)", () => {
    expect(getVisibleSceneRect(createCamera(), { width: 800, height: 600 })).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
  });

  it("scrolled + zoomed camera maps to the correspondingly shifted/scaled scene rect", () => {
    const camera: Camera = { scrollX: -100, scrollY: -100, zoom: 2 };
    // screenToScene(0,0) = (0/2+100, 0/2+100) = (100,100)
    // screenToScene(800,600) = (800/2+100, 600/2+100) = (500,400)
    expect(getVisibleSceneRect(camera, { width: 800, height: 600 })).toEqual({
      x: 100,
      y: 100,
      width: 400,
      height: 300,
    });
  });
});

describe("elementIntersectsRect", () => {
  const rect: SceneRect = { x: 0, y: 0, width: 100, height: 100 };

  it("returns true for an element fully inside the rect", () => {
    expect(elementIntersectsRect({ x: 10, y: 10, width: 20, height: 20 }, rect)).toBe(true);
  });

  it("returns false for an element fully outside the rect", () => {
    expect(elementIntersectsRect({ x: 200, y: 200, width: 20, height: 20 }, rect)).toBe(false);
  });

  it("returns true for an element straddling the rect boundary", () => {
    expect(elementIntersectsRect({ x: -10, y: -10, width: 20, height: 20 }, rect)).toBe(true);
  });

  it("returns false for an element merely touching the edge (no overlapping area)", () => {
    // Element starts exactly where the rect ends — shares a boundary line, not an area.
    expect(elementIntersectsRect({ x: 100, y: 0, width: 10, height: 10 }, rect)).toBe(false);
  });

  it("returns true for an element that fully contains the rect", () => {
    expect(elementIntersectsRect({ x: -50, y: -50, width: 200, height: 200 }, rect)).toBe(true);
  });
});

describe("filterVisibleElements", () => {
  it("filters an already-fetched element array the same way getVisibleElements does", () => {
    const scene = new Scene();
    const inside = scene.addElement(createGenericElement({ x: 10, y: 10, width: 20, height: 20 }));
    const outside = scene.addElement(createGenericElement({ x: 5000, y: 5000, width: 20, height: 20 }));
    const camera = createCamera();
    const viewportSize = { width: 800, height: 600 };

    const filtered = filterVisibleElements(scene.getElements(), camera, viewportSize);
    const viaScene = getVisibleElements(scene, camera, viewportSize);

    expect(filtered.map((el) => el.id)).toEqual(viaScene.map((el) => el.id));
    expect(filtered.map((el) => el.id)).toContain(inside.id);
    expect(filtered.map((el) => el.id)).not.toContain(outside.id);
  });

  it("preserves the input array's order rather than re-sorting", () => {
    const c = createGenericElement({ x: 40, y: 0, width: 10, height: 10 });
    const a = createGenericElement({ x: 0, y: 0, width: 10, height: 10 });
    const b = createGenericElement({ x: 20, y: 0, width: 10, height: 10 });

    const filtered = filterVisibleElements([c, a, b], createCamera(), { width: 800, height: 600 });
    expect(filtered.map((el) => el.id)).toEqual([c.id, a.id, b.id]);
  });
});

describe("getVisibleElements", () => {
  it("excludes elements outside the viewport and includes those inside/straddling it", () => {
    const scene = new Scene();
    const inside = scene.addElement(createGenericElement({ x: 10, y: 10, width: 20, height: 20 }));
    const straddling = scene.addElement(createGenericElement({ x: -5, y: -5, width: 20, height: 20 }));
    const outside = scene.addElement(createGenericElement({ x: 5000, y: 5000, width: 20, height: 20 }));

    const visible = getVisibleElements(scene, createCamera(), { width: 800, height: 600 });
    const visibleIds = visible.map((element) => element.id);

    expect(visibleIds).toContain(inside.id);
    expect(visibleIds).toContain(straddling.id);
    expect(visibleIds).not.toContain(outside.id);
  });

  it("excludes soft-deleted elements even when their bounds are in view", () => {
    const scene = new Scene();
    const element = scene.addElement(createGenericElement({ x: 10, y: 10, width: 20, height: 20 }));
    scene.deleteElement(element.id);

    const visible = getVisibleElements(scene, createCamera(), { width: 800, height: 600 });
    expect(visible.map((el) => el.id)).not.toContain(element.id);
  });

  it("preserves the scene's z-order among the visible subset", () => {
    const scene = new Scene();
    const a = scene.addElement(createGenericElement({ x: 0, y: 0, width: 10, height: 10 }));
    const b = scene.addElement(createGenericElement({ x: 20, y: 0, width: 10, height: 10 }));
    const c = scene.addElement(createGenericElement({ x: 40, y: 0, width: 10, height: 10 }));

    const visible = getVisibleElements(scene, createCamera(), { width: 800, height: 600 });
    expect(visible.map((el) => el.id)).toEqual([a.id, b.id, c.id]);
  });
});
