import { describe, expect, it } from "vitest";
import { createCylinderElement, createRectangleElement } from "../elements/shape-elements";
import type { TextElement } from "../elements/text-element";
import { Scene } from "../scene/scene";
import { createFixedWidthTextMeasurer } from "./text-measurement";
import { bindTextToContainer, getOrCreateBoundText } from "./bound-text";
import { registerBoundTextContainerSyncHook } from "./bound-text-container-sync";

function setupBoundContainer(scene: Scene) {
  const container = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
  const { textElementId } = getOrCreateBoundText(scene, container.id);
  bindTextToContainer(scene, container.id, textElementId);
  scene.updateElement(textElementId, { text: "hello" } as Partial<TextElement>);
  return { containerId: container.id, textId: textElementId };
}

describe("registerBoundTextContainerSyncHook", () => {
  it("moves the bound text along when its container moves", () => {
    const scene = new Scene();
    const measurer = createFixedWidthTextMeasurer(6);
    const unregister = registerBoundTextContainerSyncHook(scene, measurer);
    const { containerId, textId } = setupBoundContainer(scene);
    const before = scene.getElement(textId)!;

    scene.updateElement(containerId, { x: 200, y: 300 });

    const after = scene.getElement(textId)!;
    expect(after.x).toBe(before.x + 200);
    expect(after.y).toBe(before.y + 300);
    unregister();
  });

  it("moves the label of a diagram shape (cylinder) — every bindable container type syncs", () => {
    // Regression: Mermaid import binds labels inside cylinder/hexagon/… shapes; when those types were
    // missing from BINDABLE_CONTAINER_TYPES, a select-all drag moved the shapes but left their labels
    // behind (only bound text of rect/ellipse/diamond/note followed).
    const scene = new Scene();
    const measurer = createFixedWidthTextMeasurer(6);
    const unregister = registerBoundTextContainerSyncHook(scene, measurer);
    const container = scene.addElement(createCylinderElement({ x: 0, y: 0, width: 120, height: 60 }));
    const { textElementId } = getOrCreateBoundText(scene, container.id);
    bindTextToContainer(scene, container.id, textElementId);
    scene.updateElement(textElementId, { text: "Postgres" } as Partial<TextElement>);
    const before = scene.getElement(textElementId)!;

    scene.updateElement(container.id, { x: 150, y: 90 });

    const after = scene.getElement(textElementId)!;
    expect(after.x).toBe(before.x + 150);
    expect(after.y).toBe(before.y + 90);
    unregister();
  });

  it("re-wraps the bound text to a new width when the container resizes", () => {
    const scene = new Scene();
    const measurer = createFixedWidthTextMeasurer(6);
    const unregister = registerBoundTextContainerSyncHook(scene, measurer);
    const { containerId, textId } = setupBoundContainer(scene);

    scene.updateElement(containerId, { width: 300 });

    const text = scene.getElement(textId) as { width: number };
    expect(text.width).toBeCloseTo(300 - 5 * 2, 5); // BOUND_TEXT_PADDING on each side
    unregister();
  });

  it("grows the container height (and repositions text) when a narrower width forces wrapping", () => {
    const scene = new Scene();
    const measurer = createFixedWidthTextMeasurer(20); // wide characters -> wraps easily
    const unregister = registerBoundTextContainerSyncHook(scene, measurer);
    const { containerId, textId } = setupBoundContainer(scene);
    scene.updateElement(textId, { text: "hello world this wraps a lot" } as Partial<TextElement>);

    scene.updateElement(containerId, { width: 40 });

    const container = scene.getElement(containerId)!;
    expect(container.height).toBeGreaterThan(50);
    unregister();
  });

  it("does nothing for an update that doesn't change position/size (no infinite loop, no spurious writes)", () => {
    const scene = new Scene();
    const measurer = createFixedWidthTextMeasurer(6);
    const unregister = registerBoundTextContainerSyncHook(scene, measurer);
    const { containerId, textId } = setupBoundContainer(scene);
    const before = scene.getElement(textId)!;

    scene.updateElement(containerId, { strokeColor: "#ff0000" });

    const after = scene.getElement(textId)!;
    expect(after.version).toBe(before.version); // no write happened
    unregister();
  });

  it("grows the container and re-lays the label out when the label's own font size changes", () => {
    const scene = new Scene();
    const measurer = createFixedWidthTextMeasurer(6);
    const unregister = registerBoundTextContainerSyncHook(scene, measurer);
    const { containerId, textId } = setupBoundContainer(scene);
    const beforeHeight = scene.getElement(containerId)!.height;

    // The panel writes nothing but `fontSize` — every geometry consequence has to follow from the hook.
    scene.updateElement(textId, { fontSize: 96 } as Partial<TextElement>);

    const container = scene.getElement(containerId)!;
    const text = scene.getElement(textId) as TextElement;
    expect(container.height).toBeGreaterThan(beforeHeight); // the box absorbed the taller line
    expect(text.height).toBeGreaterThan(0);
    // …and the label is still centred inside the box it just grew, not left at the old offset.
    expect(text.y + text.height / 2).toBeCloseTo(container.y + container.height / 2, 5);
    unregister();
  });

  it("ignores a container with no bound text", () => {
    const scene = new Scene();
    const measurer = createFixedWidthTextMeasurer(6);
    const unregister = registerBoundTextContainerSyncHook(scene, measurer);
    const container = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 50, height: 50 }));
    expect(() => scene.updateElement(container.id, { x: 10 })).not.toThrow();
    unregister();
  });

  describe("rotation", () => {
    /** `verticalAlign: "top"` (instead of the default "middle") gives the text a center off the container's own center, so the orbit-around-container-center math is actually exercised — a perfectly centered label's center coincides with the pivot and would "pass" even with no rotation math at all. */
    function setupOffCenterBoundContainer(scene: Scene) {
      const { containerId, textId } = setupBoundContainer(scene);
      scene.updateElement(textId, { verticalAlign: "top" } as Partial<TextElement>);
      return { containerId, textId };
    }

    it("rotating the container rotates the bound text to match and orbits its position around the container's center", () => {
      const scene = new Scene();
      const measurer = createFixedWidthTextMeasurer(6);
      const unregister = registerBoundTextContainerSyncHook(scene, measurer);
      const { containerId, textId } = setupOffCenterBoundContainer(scene);

      scene.updateElement(containerId, { angle: Math.PI / 2 });

      const text = scene.getElement(textId)!;
      expect(text.angle).toBeCloseTo(Math.PI / 2, 5);
      // Container center (50,25); text was above-center (unrotated center (50,17.5)) -> a 90deg
      // rotation orbits it to the container's right side (57.5,25) -> box top-left (12.5, 12.5).
      expect(text.x).toBeCloseTo(12.5, 5);
      expect(text.y).toBeCloseTo(12.5, 5);
      unregister();
    });

    it("rotate then resize keeps the label glued (angle preserved, position recomputed against the new size)", () => {
      const scene = new Scene();
      const measurer = createFixedWidthTextMeasurer(6);
      const unregister = registerBoundTextContainerSyncHook(scene, measurer);
      const { containerId, textId } = setupOffCenterBoundContainer(scene);

      scene.updateElement(containerId, { angle: Math.PI / 2 });
      scene.updateElement(containerId, { width: 60 });

      const text = scene.getElement(textId)!;
      expect(text.angle).toBeCloseTo(Math.PI / 2, 5); // still rotated after the resize
      expect((text as { width: number }).width).toBeCloseTo(60 - 5 * 2, 5); // re-wrapped to the new width
      unregister();
    });

    it("a combined move+rotate update (both x/y and angle in one Scene.updateElement call) glues correctly in one pass", () => {
      const scene = new Scene();
      const measurer = createFixedWidthTextMeasurer(6);
      const unregister = registerBoundTextContainerSyncHook(scene, measurer);
      const { containerId, textId } = setupOffCenterBoundContainer(scene);

      scene.updateElement(containerId, { x: 100, y: 200, angle: Math.PI / 2 });

      const text = scene.getElement(textId)!;
      expect(text.angle).toBeCloseTo(Math.PI / 2, 5);
      expect(text.x).toBeCloseTo(112.5, 5);
      expect(text.y).toBeCloseTo(212.5, 5);
      unregister();
    });

    it("angle 0 (the common case) reduces to the pre-existing unrotated layout — no regression", () => {
      const scene = new Scene();
      const measurer = createFixedWidthTextMeasurer(6);
      const unregister = registerBoundTextContainerSyncHook(scene, measurer);
      const { containerId, textId } = setupOffCenterBoundContainer(scene);

      scene.updateElement(containerId, { x: 20, y: 30 });

      const text = scene.getElement(textId)!;
      expect(text.angle).toBe(0);
      expect(text.x).toBeCloseTo(20 + 5, 5);
      expect(text.y).toBeCloseTo(30 + 5, 5); // top-aligned: container.y + BOUND_TEXT_PADDING
      unregister();
    });
  });
});
