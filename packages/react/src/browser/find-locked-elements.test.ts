/**
 * Regression pins for the effectiveLocked retrofit: double-clicking a LOCKED element (element-level
 * or via a locked layer) must never resolve an editor target — the check the three shipped finders
 * originally lacked (a locked shape's label editor opened in production).
 */
import { describe, expect, it } from "vitest";
import { createArrowElement, createNoteElement, createTextElement, Scene } from "@deviva-draw/engine";
import { findArrowAt } from "./find-arrow-at-point";
import { findBindableContainerAt } from "./find-bindable-container-at-point";
import { findStandaloneTextAt } from "./find-standalone-text-at-point";

function sceneWith<T extends { id: string }>(build: () => T) {
  const scene = new Scene();
  const element = scene.addElement(build() as never);
  return { scene, element };
}

describe("dblclick finders — locked elements offer no editor", () => {
  it("a locked note (bindable container) is skipped; unlocked is found", () => {
    const { scene, element } = sceneWith(() => createNoteElement({ x: 0, y: 0, width: 100, height: 60 }));
    expect(findBindableContainerAt(scene, { x: 50, y: 30 })?.id).toBe(element.id);
    scene.updateElement(element.id, { locked: true });
    expect(findBindableContainerAt(scene, { x: 50, y: 30 })).toBeNull();
  });

  it("a locked arrow is skipped; unlocked is found", () => {
    const { scene, element } = sceneWith(() => createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }));
    expect(findArrowAt(scene, { x: 50, y: 0 })?.id).toBe(element.id);
    scene.updateElement(element.id, { locked: true });
    expect(findArrowAt(scene, { x: 50, y: 0 })).toBeNull();
  });

  it("a locked standalone text is skipped; unlocked is found", () => {
    const { scene, element } = sceneWith(() => createTextElement({ x: 0, y: 0, width: 80, height: 25, text: "hi" }));
    expect(findStandaloneTextAt(scene, { x: 40, y: 10 })?.id).toBe(element.id);
    scene.updateElement(element.id, { locked: true });
    expect(findStandaloneTextAt(scene, { x: 40, y: 10 })).toBeNull();
  });

  it("a LAYER-locked container is skipped too (effectiveLocked, not just element.locked)", () => {
    const { scene, element } = sceneWith(() => createNoteElement({ x: 0, y: 0, width: 100, height: 60 }));
    const layer = scene.addLayer("gated");
    scene.updateElement(element.id, { layerId: layer.id });
    scene.setLayerLocked(layer.id, true);
    expect(findBindableContainerAt(scene, { x: 50, y: 30 })).toBeNull();
  });
});
