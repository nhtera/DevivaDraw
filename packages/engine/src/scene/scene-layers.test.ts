import { describe, expect, it } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "./scene";
import { DEFAULT_LAYER_NAME, MAX_LAYERS } from "./scene-layers";

function rect(x = 10): ReturnType<typeof createRectangleElement> {
  return createRectangleElement({ x, y: 20, width: 30, height: 40 });
}

describe("Scene layers — construction invariant", () => {
  it("a bare new Scene() self-initializes one visible, unlocked default layer that is also active", () => {
    const scene = new Scene();
    const layers = scene.getLayers();
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ name: DEFAULT_LAYER_NAME, visible: true, locked: false });
    expect(scene.getActiveLayerId()).toBe(layers[0]!.id);
    expect(scene.getDefaultLayerId()).toBe(layers[0]!.id);
  });

  it("default-layer elements are never stamped; non-default active layer stamps new elements", () => {
    const scene = new Scene();
    const onDefault = scene.addElement(rect());
    expect(onDefault.layerId).toBeUndefined();

    const upper = scene.addLayer();
    scene.setActiveLayer(upper.id);
    const onUpper = scene.addElement(rect(50));
    expect(onUpper.layerId).toBe(upper.id);

    // An element arriving with its own membership (draw-to-shape replacement, cross-layer paste) keeps it.
    const explicit = scene.addElement({ ...rect(90), id: "explicit", layerId: upper.id });
    expect(explicit.layerId).toBe(upper.id);
  });
});

describe("Scene layers — ordering", () => {
  it("layer position dominates the sort; fractional index orders within a layer", () => {
    const scene = new Scene();
    const bottomTop = scene.addElement(rect(1)); // default layer, highest index there
    const upper = scene.addLayer();
    scene.setActiveLayer(upper.id);
    const upperLow = scene.addElement(rect(2));
    scene.setActiveLayer(scene.getDefaultLayerId());
    const bottomLater = scene.addElement(rect(3)); // default layer again, added AFTER upperLow

    const order = scene.getElements().map((element) => element.id);
    // Both default-layer elements paint before the upper-layer one, regardless of insertion time.
    expect(order.indexOf(bottomTop.id)).toBeLessThan(order.indexOf(upperLow.id));
    expect(order.indexOf(bottomLater.id)).toBeLessThan(order.indexOf(upperLow.id));
  });

  it("moving a layer reorders its whole band; the default role follows its id, not position 0", () => {
    const scene = new Scene();
    const onDefault = scene.addElement(rect(1));
    const upper = scene.addLayer();
    scene.setActiveLayer(upper.id);
    const onUpper = scene.addElement(rect(2));

    scene.moveLayer(upper.id, -1); // upper now BELOW the default layer
    const order = scene.getElements().map((element) => element.id);
    expect(order.indexOf(onUpper.id)).toBeLessThan(order.indexOf(onDefault.id));
    // The unstamped element still belongs to the default layer even though it's no longer bottom-most.
    expect(scene.resolveLayer(onDefault).id).toBe(scene.getDefaultLayerId());
  });
});

describe("Scene layers — operations", () => {
  it("rename/visible/locked mutate and notify; unknown ids no-op", () => {
    const scene = new Scene();
    const layer = scene.addLayer("Notes");
    let notified = 0;
    scene.subscribe(() => (notified += 1));

    scene.renameLayer(layer.id, "  Annotations  ");
    expect(scene.getLayer(layer.id)?.name).toBe("Annotations");
    scene.setLayerVisible(layer.id, false);
    scene.setLayerLocked(layer.id, true);
    expect(scene.getLayer(layer.id)).toMatchObject({ visible: false, locked: true });
    expect(notified).toBe(3);

    scene.renameLayer("missing", "x");
    scene.setActiveLayer("missing");
    expect(notified).toBe(3); // no-ops never notify
    expect(scene.getActiveLayerId()).toBe(scene.getDefaultLayerId());
  });

  it("removeLayer re-homes elements (including soft-deleted) and refuses the last layer", () => {
    const scene = new Scene();
    const upper = scene.addLayer();
    scene.setActiveLayer(upper.id);
    const kept = scene.addElement(rect(1));
    const deleted = scene.addElement(rect(2));
    scene.deleteElement(deleted.id);

    expect(scene.removeLayer(scene.getDefaultLayerId(), scene.getDefaultLayerId())).toBe(false); // self-destination refused
    expect(scene.removeLayer(upper.id, scene.getDefaultLayerId())).toBe(true);
    // Re-homed to the DEFAULT layer means unstamped again — the wire-minimal convention.
    expect(scene.getElement(kept.id)?.layerId).toBeUndefined();
    expect(scene.getElement(deleted.id)?.layerId).toBeUndefined();
    expect(scene.getLayers()).toHaveLength(1);
    expect(scene.removeLayer(scene.getDefaultLayerId(), "anything")).toBe(false); // last layer immortal
  });

  it("deleting the layer that owns the default role hands it to the bottom layer", () => {
    const scene = new Scene();
    const originalDefault = scene.getDefaultLayerId();
    const upper = scene.addLayer();
    scene.removeLayer(originalDefault, upper.id);
    expect(scene.getDefaultLayerId()).toBe(upper.id);
  });

  it("delete-layer then element-undo interleaving stays safe: orphaned membership resolves to default at read time, verbatim id preserved", () => {
    const scene = new Scene();
    const upper = scene.addLayer();
    scene.setActiveLayer(upper.id);
    const element = scene.addElement(rect(1));
    const snapshotBeforeDelete = scene.getElements(); // what a history batch would have captured

    scene.removeLayer(upper.id, scene.getDefaultLayerId());
    scene.loadElementsSnapshot(snapshotBeforeDelete); // the undo restore path

    const restored = scene.getElement(element.id)!;
    expect(restored.layerId).toBe(upper.id); // stored id preserved VERBATIM — never rewritten
    expect(scene.resolveLayer(restored).id).toBe(scene.getDefaultLayerId()); // but resolves safely
    expect(scene.getElements().map((entry) => entry.id)).toContain(element.id); // and still sorts/renders
  });
});

describe("Scene layers — replaceLayers guards", () => {
  it("refuses an empty or over-cap list, keeping the scene untouched (hostile-input guard)", () => {
    const scene = new Scene();
    const before = scene.getLayers();
    expect(scene.replaceLayers([])).toBe(false);
    const oversized = Array.from({ length: MAX_LAYERS + 1 }, (_, index) => ({ id: `layer-${index}`, name: `L${index}`, visible: true, locked: false }));
    expect(scene.replaceLayers(oversized)).toBe(false);
    expect(scene.getLayers()).toEqual(before);
  });

  it("adopts a valid list; the bottom layer takes the default role and an unknown active id falls back to it", () => {
    const scene = new Scene();
    const adopted = [
      { id: "base", name: "Base", visible: true, locked: false },
      { id: "top", name: "Top", visible: false, locked: true },
    ];
    expect(scene.replaceLayers(adopted, "nope")).toBe(true);
    expect(scene.getLayers().map((layer) => layer.id)).toEqual(["base", "top"]);
    expect(scene.getDefaultLayerId()).toBe("base");
    expect(scene.getActiveLayerId()).toBe("base");
  });
});

describe("Scene layers — draw-to-shape layer carry", () => {
  it("a recognized shape created from a stroke keeps the stroke's layer even after the active layer changed", async () => {
    const { createFreedrawElement } = await import("../elements/freedraw-element");
    const { recognizeFreedrawShape } = await import("../tools/shape-recognition");

    const scene = new Scene();
    const sketch = scene.addLayer("Sketch");
    scene.setActiveLayer(sketch.id);
    // A closed-ish rectangle stroke the recognizer accepts.
    const stroke = scene.addElement(
      createFreedrawElement({
        x: 0,
        y: 0,
        points: [
          [0, 0, 0.5],
          [100, 0, 0.5],
          [100, 80, 0.5],
          [0, 80, 0.5],
          [0, 4, 0.5],
        ],
      }),
    );
    expect(stroke.layerId).toBe(sketch.id);

    const notes = scene.addLayer("Notes");
    scene.setActiveLayer(notes.id);
    const shape = recognizeFreedrawShape(stroke as never);
    expect(shape).not.toBeNull();
    // The replacement flow: delete stroke, add shape — membership must survive the swap.
    scene.deleteElement(stroke.id);
    const added = scene.addElement(shape!);
    expect(added.layerId).toBe(sketch.id);
  });
});
