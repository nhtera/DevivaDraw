import { describe, expect, it } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { bringForward, bringToFront, sendBackward, sendToBack } from "./z-order-ops";

function seedScene(count: number): { scene: Scene; ids: string[] } {
  const scene = new Scene();
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) ids.push(scene.addElement(createRectangleElement({ x: i, y: 0, width: 10, height: 10 })).id);
  return { scene, ids };
}

describe("bringToFront", () => {
  it("moves the selected elements to the top, preserving their relative order", () => {
    const { scene, ids } = seedScene(4); // z-order: 0,1,2,3 (back to front)
    bringToFront(scene, [ids[0]!, ids[2]!]);
    const order = scene.getElements().map((el) => el.id);
    expect(order.slice(-2)).toEqual([ids[0], ids[2]]);
  });
});

describe("sendToBack", () => {
  it("moves the selected elements to the bottom, preserving their relative order", () => {
    const { scene, ids } = seedScene(4);
    sendToBack(scene, [ids[3]!, ids[1]!]);
    const order = scene.getElements().map((el) => el.id);
    expect(order.slice(0, 2)).toEqual([ids[1], ids[3]]);
  });
});

describe("bringForward / sendBackward", () => {
  it("bringForward swaps a single selected element past its neighbor", () => {
    const { scene, ids } = seedScene(3); // 0,1,2
    bringForward(scene, [ids[0]!]);
    const order = scene.getElements().map((el) => el.id);
    expect(order).toEqual([ids[1], ids[0], ids[2]]);
  });

  it("sendBackward swaps a single selected element before its neighbor", () => {
    const { scene, ids } = seedScene(3);
    sendBackward(scene, [ids[2]!]);
    const order = scene.getElements().map((el) => el.id);
    expect(order).toEqual([ids[0], ids[2], ids[1]]);
  });

  it("is a no-op for an element already at the extreme end", () => {
    const { scene, ids } = seedScene(2);
    expect(() => bringForward(scene, [ids[1]!])).not.toThrow();
    expect(scene.getElements().map((el) => el.id)).toEqual(ids);
  });
});
