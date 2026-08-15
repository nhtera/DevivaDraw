import { describe, expect, it } from "vitest";
import { findBindableShapeNear } from "../bindings/binding-scene-sync";
import { createRectangleElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import { serializeScene } from "../persistence/serialize-scene";
import { getVisibleElements } from "../render/viewport-culling";
import { frameContainedElementIds } from "../selection/frame-membership";
import { topmostElementAt } from "../selection/hit-test";
import { elementsInLasso } from "../selection/lasso-select";
import { elementsInMarquee } from "../selection/marquee-select";
import type { AnyElement } from "../elements/element-types";
import { findTextMatches } from "./find-text-matches";
import { Scene } from "./scene";

/**
 * Per-surface proof that hidden and layer-locked gate EVERYTHING the plan enumerates — each surface
 * attacked independently, because an implementing sweep historically misses one (the view-only
 * round's lesson).
 */

function sceneWithHiddenAndLocked(): { scene: Scene; hidden: AnyElement; layerLocked: AnyElement; plain: AnyElement } {
  const scene = new Scene();
  const plain = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 50, height: 50, backgroundColor: "#fff" }));

  const hiddenLayer = scene.addLayer("Hidden");
  scene.setActiveLayer(hiddenLayer.id);
  const hidden = scene.addElement(createRectangleElement({ x: 100, y: 0, width: 50, height: 50, backgroundColor: "#fff" }));

  const lockedLayer = scene.addLayer("Locked");
  scene.setActiveLayer(lockedLayer.id);
  const layerLocked = scene.addElement(createRectangleElement({ x: 200, y: 0, width: 50, height: 50, backgroundColor: "#fff" }));

  scene.setLayerVisible(hiddenLayer.id, false);
  scene.setLayerLocked(lockedLayer.id, true);
  return { scene, hidden, layerLocked, plain };
}

describe("layer gating — predicates", () => {
  it("isElementHidden / effectiveLocked / selectableElements agree", () => {
    const { scene, hidden, layerLocked, plain } = sceneWithHiddenAndLocked();
    expect(scene.isElementHidden(hidden)).toBe(true);
    expect(scene.isElementHidden(plain)).toBe(false);
    expect(scene.effectiveLocked(layerLocked)).toBe(true);
    expect(scene.effectiveLocked(plain)).toBe(false);
    expect(scene.selectableElements().map((element) => element.id)).toEqual([plain.id]);
  });
});

describe("layer gating — interaction surfaces", () => {
  it("click hit-testing skips hidden and layer-locked (the eraser/fill/select choke point)", () => {
    const { scene, hidden, layerLocked, plain } = sceneWithHiddenAndLocked();
    expect(topmostElementAt(scene, { x: 125, y: 25 }, 5)).toBeNull(); // over hidden
    expect(topmostElementAt(scene, { x: 225, y: 25 }, 5)).toBeNull(); // over layer-locked
    expect(topmostElementAt(scene, { x: 25, y: 25 }, 5)?.id).toBe(plain.id);
    void hidden;
    void layerLocked;
  });

  it("marquee and lasso sweeps only pick up the plain element", () => {
    const { scene, plain } = sceneWithHiddenAndLocked();
    const everything = { x: -10, y: -10, width: 300, height: 100 };
    expect(elementsInMarquee(scene.selectableElements(), everything, "intersect").map((element) => element.id)).toEqual([plain.id]);
    const loop = [
      { x: -10, y: -10 },
      { x: 300, y: -10 },
      { x: 300, y: 100 },
      { x: -10, y: 100 },
    ];
    expect(elementsInLasso(scene.selectableElements(), loop).map((element) => element.id)).toEqual([plain.id]);
  });

  it("arrow binding refuses hidden and layer-locked targets", () => {
    const { scene } = sceneWithHiddenAndLocked();
    expect(findBindableShapeNear(scene, { x: 125, y: 25 }, 10)).toBeNull(); // hidden
    expect(findBindableShapeNear(scene, { x: 225, y: 25 }, 10)).toBeNull(); // layer-locked
    expect(findBindableShapeNear(scene, { x: 25, y: 25 }, 10)).not.toBeNull(); // plain still binds
  });

  it("frame capture never geometrically kidnaps hidden elements (locked parity: still captured, like element-locked today)", () => {
    const { scene, hidden, layerLocked, plain } = sceneWithHiddenAndLocked();
    const frame = scene.addElement({ ...createRectangleElement({ x: -20, y: -20, width: 320, height: 120 }), id: "frame-1", type: "frame" } as never);
    const captured = frameContainedElementIds(scene, frame.id);
    expect(captured).not.toContain(hidden.id);
    expect(captured).toContain(plain.id);
    expect(captured).toContain(layerLocked.id);
  });

  it("find skips hidden text but still finds layer-locked text", () => {
    const scene = new Scene();
    const hiddenLayer = scene.addLayer("Hidden");
    scene.setActiveLayer(hiddenLayer.id);
    scene.addElement(createTextElement({ x: 0, y: 0, text: "secret note" }));
    const lockedLayer = scene.addLayer("Locked");
    scene.setActiveLayer(lockedLayer.id);
    scene.addElement(createTextElement({ x: 0, y: 50, text: "visible note" }));
    scene.setLayerVisible(hiddenLayer.id, false);
    scene.setLayerLocked(lockedLayer.id, true);

    expect(findTextMatches(scene, "secret")).toEqual([]);
    expect(findTextMatches(scene, "visible")).toHaveLength(1);
  });
});

describe("layer gating — output surfaces", () => {
  it("viewport culling and the visible-element list exclude hidden layers", () => {
    const { scene, hidden, plain } = sceneWithHiddenAndLocked();
    const visible = getVisibleElements(scene, { scrollX: 0, scrollY: 0, zoom: 1 }, { width: 1000, height: 1000 });
    expect(visible.map((element) => element.id)).not.toContain(hidden.id);
    expect(visible.map((element) => element.id)).toContain(plain.id);
  });

  it("serializeScene excludeHidden drops hidden-layer elements — and ONLY when asked (full-fidelity saves keep them)", () => {
    const { scene, hidden } = sceneWithHiddenAndLocked();
    const embedded = serializeScene(scene, { excludeHidden: true });
    expect(embedded.elements.map((element) => element.id)).not.toContain(hidden.id);
    expect(JSON.stringify(embedded)).not.toContain(hidden.id);

    const fullFidelity = serializeScene(scene);
    expect(fullFidelity.elements.map((element) => element.id)).toContain(hidden.id);
  });
});

describe("layer gating — unhide restores bit-identically", () => {
  it("hide then unhide leaves the element untouched (no version bump, same geometry)", () => {
    const { scene, hidden } = sceneWithHiddenAndLocked();
    const before = scene.getElement(hidden.id)!;
    const hiddenLayerId = scene.resolveLayer(before).id;
    scene.setLayerVisible(hiddenLayerId, true);
    const after = scene.getElement(hidden.id)!;
    expect(after).toBe(before); // the exact same frozen object — hiding is pure view state
    expect(topmostElementAt(scene, { x: 125, y: 25 }, 5)?.id).toBe(hidden.id); // and it's hittable again
  });
});
