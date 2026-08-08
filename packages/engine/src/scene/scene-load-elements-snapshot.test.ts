import { describe, expect, it } from "vitest";
import { createGenericElement } from "../elements/element-types";
import { Scene } from "./scene";

describe("Scene.loadElementsSnapshot (undo/redo restore)", () => {
  it("replaces the entire element set with exactly the given snapshot", () => {
    const scene = new Scene();
    const a = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const snapshot = scene.getElements();
    scene.addElement(createGenericElement({ x: 10, y: 10 }));
    expect(scene.getElements()).toHaveLength(2);

    scene.loadElementsSnapshot(snapshot);

    expect(scene.getElements()).toEqual([a]);
  });

  it("does not bump version/versionNonce/updated on restored elements", () => {
    const scene = new Scene();
    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const updated = scene.updateElement(created.id, { x: 99 })!;
    const snapshotWithOriginal = [created];

    scene.loadElementsSnapshot(snapshotWithOriginal);

    expect(scene.getElement(created.id)).toEqual(created);
    expect(scene.getElement(created.id)?.version).not.toBe(updated.version + 1);
  });

  it("notifies subscribers exactly once", () => {
    const scene = new Scene();
    const snapshot = scene.getElements();
    let notifyCount = 0;
    scene.subscribe(() => (notifyCount += 1));

    scene.loadElementsSnapshot(snapshot);

    expect(notifyCount).toBe(1);
  });

  it("leaves stored files untouched (undo of an image insert keeps the file for a later redo)", () => {
    const scene = new Scene();
    scene.addFile("file-1", { mimeType: "image/png", dataURL: "data:image/png;base64,AA==", createdAt: 0 });
    const emptySnapshot: ReturnType<Scene["getElements"]> = [];

    scene.loadElementsSnapshot(emptySnapshot);

    expect(scene.hasFile("file-1")).toBe(true);
  });
});
