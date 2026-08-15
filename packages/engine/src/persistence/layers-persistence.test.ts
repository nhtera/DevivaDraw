import { describe, expect, it } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { bringToFront } from "../selection/z-order-ops";
import { deserializeScene, deserializeSceneLenient, serializeScene } from "./serialize-scene";

function sceneWithTwoLayers(): { scene: Scene; upperId: string; onDefaultId: string; onUpperId: string } {
  const scene = new Scene();
  const onDefault = scene.addElement(createRectangleElement({ x: 1, y: 1, width: 10, height: 10 }));
  const upper = scene.addLayer("Annotations");
  scene.setActiveLayer(upper.id);
  scene.setLayerLocked(upper.id, true);
  const onUpper = scene.addElement(createRectangleElement({ x: 50, y: 50, width: 10, height: 10 }));
  return { scene, upperId: upper.id, onDefaultId: onDefault.id, onUpperId: onUpper.id };
}

describe("layers persistence", () => {
  it("an untouched scene serializes with NO layers field — byte-identical to pre-layers output", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 1, y: 1, width: 10, height: 10 }));
    const document = serializeScene(scene);
    expect(document.layers).toBeUndefined();
    expect(document.activeLayerId).toBeUndefined();
    expect(document.elements[0]!.layerId).toBeUndefined();
    expect(JSON.stringify(document)).not.toContain("layer");
  });

  it("round-trips layers, flags, membership, and the active layer through serialize → JSON → deserialize", () => {
    const { scene, upperId, onDefaultId, onUpperId } = sceneWithTwoLayers();
    const raw = JSON.parse(JSON.stringify(serializeScene(scene))) as unknown;

    const result = deserializeScene(raw);
    if (!result.ok) throw new Error(result.error);
    const restored = result.scene;
    expect(restored.getLayers().map((layer) => ({ id: layer.id, name: layer.name, locked: layer.locked }))).toEqual([
      { id: scene.getDefaultLayerId(), name: "Layer 1", locked: false },
      { id: upperId, name: "Annotations", locked: true },
    ]);
    expect(restored.getActiveLayerId()).toBe(upperId);
    expect(restored.getElement(onDefaultId)?.layerId).toBeUndefined();
    expect(restored.getElement(onUpperId)?.layerId).toBe(upperId);
  });

  it("a legacy document (no layers field) loads as one default layer owning everything", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 1, y: 1, width: 10, height: 10 }));
    const raw = JSON.parse(JSON.stringify(serializeScene(scene))) as Record<string, unknown>;
    delete raw.layers; // already absent, but make the intent explicit

    const result = deserializeScene(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.scene.getLayers()).toHaveLength(1);
  });

  it("an orphaned element layerId survives the load VERBATIM and resolves to the default layer at read time", () => {
    const { scene } = sceneWithTwoLayers();
    const raw = JSON.parse(JSON.stringify(serializeScene(scene))) as { layers?: unknown[]; elements: { id: string; layerId?: string }[] };
    delete raw.layers; // simulate an old build's resave: layer list dropped, element membership kept

    const result = deserializeScene(raw);
    if (!result.ok) throw new Error(result.error);
    const orphan = [...result.scene.elementsUnsorted()].find((element) => element.layerId !== undefined)!;
    expect(orphan.layerId).toBeDefined(); // preserved verbatim — never rewritten on load
    expect(result.scene.resolveLayer(orphan).id).toBe(result.scene.getDefaultLayerId());
    expect(result.scene.getElements().length).toBe(2); // nothing lost — the documented flatten degradation
  });

  it("lenient path salvages a partially-corrupt layers list entry-by-entry with reasons; strict path rejects", () => {
    const { scene } = sceneWithTwoLayers();
    const raw = JSON.parse(JSON.stringify(serializeScene(scene))) as { layers: unknown[] };
    raw.layers.push({ id: "bad", name: 42, visible: "yes", locked: null }, { id: raw.layers[0]!["id" as never], name: "dup", visible: true, locked: false });

    const lenient = deserializeSceneLenient(raw);
    if (!lenient.ok) throw new Error(lenient.error);
    expect(lenient.scene.getLayers()).toHaveLength(2); // the two good entries; bad + duplicate dropped
    expect(lenient.droppedErrors.some((error) => error.includes("layers["))).toBe(true);

    const strict = deserializeScene(raw);
    expect(strict.ok).toBe(false);
  });

  it("a hostile layers list (non-array, or over the cap) degrades to the default layer instead of failing the board on the lenient path", () => {
    const { scene } = sceneWithTwoLayers();
    const raw = JSON.parse(JSON.stringify(serializeScene(scene))) as Record<string, unknown>;
    raw.layers = "not-an-array";

    const lenient = deserializeSceneLenient(raw);
    if (!lenient.ok) throw new Error(lenient.error);
    expect(lenient.scene.getLayers()).toHaveLength(1);
    expect(lenient.droppedErrors.some((error) => error.includes('"layers"'))).toBe(true);
  });

  it("z-order ops never cross layer boundaries", () => {
    const { scene, onDefaultId, onUpperId } = sceneWithTwoLayers();
    bringToFront(scene, [onDefaultId]);
    const order = scene.getElements().map((element) => element.id);
    // "Front" of the default layer is still BELOW everything on the upper layer.
    expect(order.indexOf(onDefaultId)).toBeLessThan(order.indexOf(onUpperId));
  });
});
