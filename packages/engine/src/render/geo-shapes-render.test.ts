import { describe, expect, it } from "vitest";
import {
  createBlockArrowElement,
  createCheckBoxElement,
  createCloudElement,
  createHeartElement,
  createXBoxElement,
} from "../elements/shape-elements";
import { createNoteElement } from "../elements/note-element";
import { blockArrowUnitVertices } from "../elements/polygon-shape-geometry";
import { createCamera } from "./camera";
import { buildElementDrawable } from "./rough-renderer";
import type { RoughShapeDrawer } from "./rough-renderer";

const CAMERA = createCamera();

/** Records which drawer method each element type dispatches to. */
function recordingDrawer(): { drawer: RoughShapeDrawer; calls: string[] } {
  const calls: string[] = [];
  const stub = (name: string) => () => {
    calls.push(name);
    return { sets: [], options: {}, shape: name } as never;
  };
  return {
    calls,
    drawer: { rectangle: stub("rectangle"), ellipse: stub("ellipse"), polygon: stub("polygon"), linearPath: stub("linearPath"), path: stub("path") },
  };
}

describe("geo shape rendering dispatch", () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };

  it("block arrows render as a polygon", () => {
    const { drawer, calls } = recordingDrawer();
    buildElementDrawable(drawer, createBlockArrowElement({ ...box, direction: "right" }), CAMERA);
    expect(calls).toEqual(["polygon"]);
  });

  it("cloud/heart/x-box/check-box/note all render via a single path", () => {
    for (const element of [
      createCloudElement(box),
      createHeartElement(box),
      createXBoxElement(box),
      createCheckBoxElement(box),
      createNoteElement(box),
    ]) {
      const { drawer, calls } = recordingDrawer();
      buildElementDrawable(drawer, element, CAMERA);
      expect(calls).toEqual(["path"]);
    }
  });
});

describe("blockArrowUnitVertices", () => {
  it("gives 7 vertices for every direction and mirrors right→left across the box", () => {
    for (const dir of ["left", "right", "up", "down"] as const) expect(blockArrowUnitVertices(dir)).toHaveLength(7);
    const right = blockArrowUnitVertices("right");
    const left = blockArrowUnitVertices("left");
    right.forEach((point, i) => expect(left[i]!.x).toBeCloseTo(1 - point.x));
  });
});
