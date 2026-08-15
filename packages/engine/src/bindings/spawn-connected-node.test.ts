import { describe, expect, it } from "vitest";
import { registerArrowBindingHooks } from "./binding-scene-sync";
import { createRectangleElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import { Scene } from "../scene/scene";
import { createCanvasTextMeasurer } from "../text/text-measurement";
import { FLOW_NODE_GAP, spawnConnectedNode } from "./spawn-connected-node";
import type { ArrowElement } from "../elements/arrow-element";

function fakeMeasurer() {
  return createCanvasTextMeasurer({
    font: "",
    measureText: (text: string) => ({ width: text.length * 8, fontBoundingBoxAscent: 16, fontBoundingBoxDescent: 4 }),
  });
}

describe("spawnConnectedNode", () => {
  it("spawns a same-shaped node one gap to the right, connected by an arrow bound at both edges", () => {
    const scene = new Scene();
    registerArrowBindingHooks(scene, fakeMeasurer());
    const source = scene.addElement(createRectangleElement({ x: 100, y: 100, width: 80, height: 60 }));

    const nodeId = spawnConnectedNode(scene, source.id, "right");
    expect(nodeId).not.toBeNull();

    const node = scene.getElement(nodeId!)!;
    expect(node.type).toBe("rectangle");
    expect(node.width).toBe(80);
    expect(node.x).toBe(source.x + source.width + FLOW_NODE_GAP);
    expect(node.y).toBe(source.y);
    expect(node.groupIds).toEqual([]);

    const arrow = scene.getElements().find((element) => element.type === "arrow") as ArrowElement;
    expect(arrow.startBinding?.elementId).toBe(source.id);
    expect(arrow.startBinding?.fixedPoint).toEqual([1, 0.5]);
    expect(arrow.endBinding?.elementId).toBe(nodeId);
    expect(arrow.endBinding?.fixedPoint).toEqual([0, 0.5]);
  });

  it("spawns downward with the vertical edge anchors", () => {
    const scene = new Scene();
    registerArrowBindingHooks(scene, fakeMeasurer());
    const source = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));

    const nodeId = spawnConnectedNode(scene, source.id, "down")!;
    const node = scene.getElement(nodeId)!;
    expect(node.y).toBe(source.height + FLOW_NODE_GAP);

    const arrow = scene.getElements().find((element) => element.type === "arrow") as ArrowElement;
    expect(arrow.startBinding?.fixedPoint).toEqual([0.5, 1]);
    expect(arrow.endBinding?.fixedPoint).toEqual([0.5, 0]);
  });

  it("refuses non-bindable sources", () => {
    const scene = new Scene();
    const text = scene.addElement(createTextElement({ x: 0, y: 0, text: "not a node", width: 50, height: 20 }));
    expect(spawnConnectedNode(scene, text.id, "right")).toBeNull();
    expect(scene.getElements()).toHaveLength(1);
  });
});
