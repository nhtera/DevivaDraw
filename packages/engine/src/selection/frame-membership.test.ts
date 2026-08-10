import { describe, expect, it } from "vitest";
import { createFrameElement } from "../elements/frame-element";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { expandMovingIdsWithFrameChildren, frameContainedElementIds } from "./frame-membership";

describe("frame membership", () => {
  it("reports elements whose center is inside the frame, excluding other frames and itself", () => {
    const scene = new Scene();
    const frame = scene.addElement(createFrameElement({ x: 0, y: 0, width: 200, height: 200, name: "Frame 1" }));
    const inside = scene.addElement(createRectangleElement({ x: 50, y: 50, width: 40, height: 40 }));
    scene.addElement(createRectangleElement({ x: 400, y: 400, width: 40, height: 40 })); // outside
    scene.addElement(createFrameElement({ x: 10, y: 10, width: 20, height: 20, name: "Frame 2" })); // nested frame ignored

    expect(frameContainedElementIds(scene, frame.id)).toEqual([inside.id]);
  });

  it("expandMovingIdsWithFrameChildren adds a frame's contents to the moving set without duplicates", () => {
    const scene = new Scene();
    const frame = scene.addElement(createFrameElement({ x: 0, y: 0, width: 200, height: 200, name: "Frame 1" }));
    const child = scene.addElement(createRectangleElement({ x: 50, y: 50, width: 40, height: 40 }));

    const expanded = expandMovingIdsWithFrameChildren(scene, [frame.id]);
    expect(new Set(expanded)).toEqual(new Set([frame.id, child.id]));
  });

  it("leaves a plain (non-frame) moving set unchanged", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    expect(expandMovingIdsWithFrameChildren(scene, [rect.id])).toEqual([rect.id]);
  });
});
