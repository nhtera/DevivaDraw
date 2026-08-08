/**
 * `serializeScene`'s round trip (per element type) and export-vs-autosave options. See
 * `deserialize-scene.test.ts` for `deserializeScene`'s malformed-input rejection and
 * dangling-reference repair behavior (split out purely to keep both files under the house
 * line-count limit).
 */
import { describe, expect, it } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { createFreedrawElement } from "../elements/freedraw-element";
import { createGenericElement } from "../elements/element-types";
import { createImageElement } from "../elements/image-element";
import { createDiamondElement, createEllipseElement, createLineElement, createRectangleElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import { Scene } from "../scene/scene";
import { deserializeScene, serializeScene } from "./serialize-scene";

/** Round-trips `scene` through an actual `JSON.stringify`/`JSON.parse` pass — a real save/load never hands the live object graph straight back, only its structurally-equal JSON clone. */
function roundTrip(scene: Scene, options?: Parameters<typeof serializeScene>[1]) {
  const document = serializeScene(scene, options);
  const parsed = JSON.parse(JSON.stringify(document));
  const result = deserializeScene(parsed);
  if (!result.ok) throw new Error(`round trip failed: ${result.error}`);
  return result.scene;
}

describe("serializeScene / deserializeScene — round trip per element type", () => {
  it("round-trips a rectangle/ellipse/diamond/generic element with every base field intact", () => {
    const scene = new Scene();
    const rect = scene.addElement(
      createRectangleElement({
        x: 1, y: 2, width: 30, height: 40, angle: 0.5, strokeColor: "#123456", backgroundColor: "#abcdef",
        fillStyle: "cross-hatch", strokeWidth: 3, strokeStyle: "dashed", roughness: 2, opacity: 80,
        roundness: { type: 1 }, groupIds: ["g1", "g2"], link: "https://example.com", locked: true,
      }),
    );
    scene.addElement(createEllipseElement({ x: 0, y: 0, width: 10, height: 10 }));
    scene.addElement(createDiamondElement({ x: 0, y: 0, width: 10, height: 10 }));
    scene.addElement(createGenericElement({ x: 0, y: 0, width: 10, height: 10 }));

    const restored = roundTrip(scene);
    expect(restored.getElements()).toEqual(scene.getElements());
    expect(restored.getElement(rect.id)).toEqual(rect);
  });

  it("round-trips a line element's points", () => {
    const scene = new Scene();
    scene.addElement(createLineElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }] }));
    expect(roundTrip(scene).getElements()).toEqual(scene.getElements());
  });

  it("round-trips a freedraw element's points and simulatePressure", () => {
    const scene = new Scene();
    scene.addElement(
      createFreedrawElement({
        x: 0, y: 0,
        points: [[0, 0, 0.2], [1, 1, 0.6], [2, 2, 1]],
        simulatePressure: false,
      }),
    );
    expect(roundTrip(scene).getElements()).toEqual(scene.getElements());
  });

  it("round-trips a text element's text/font/alignment fields, including a bound (containerId) text", () => {
    const scene = new Scene();
    const container = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    scene.addElement(
      createTextElement({
        x: 10, y: 10, text: "hello\nworld", fontFamily: "code", fontSize: 24, textAlign: "center",
        verticalAlign: "middle", lineHeight: 1.5, containerId: container.id,
      }),
    );
    expect(roundTrip(scene).getElements()).toEqual(scene.getElements());
  });

  it("round-trips an arrow element's points, bindings, arrowheads, and arrowType", () => {
    const scene = new Scene();
    // Bindings must reference *real* elements in this same scene — a binding to a nonexistent id
    // is exactly what `deserializeScene`'s dangling-reference repair pass clears (see that describe
    // block below), which would make this specific test about repair, not round-trip fidelity.
    const shapeA = scene.addElement(createRectangleElement({ x: -50, y: 0, width: 10, height: 10 }));
    const shapeB = scene.addElement(createRectangleElement({ x: 100, y: 50, width: 10, height: 10 }));
    scene.addElement(
      createArrowElement({
        x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }],
        startArrowhead: "dot", endArrowhead: "triangle", arrowType: "curved",
        startBinding: { elementId: shapeA.id, focus: 0.5, gap: 4 },
        endBinding: { elementId: shapeB.id, focus: -0.2, gap: 8 },
      }),
    );
    expect(roundTrip(scene).getElements()).toEqual(scene.getElements());
  });

  it("round-trips an image element and its referenced file", () => {
    const scene = new Scene();
    scene.addFile("file1", { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", createdAt: 12345 });
    scene.addElement(createImageElement({ x: 0, y: 0, width: 20, height: 20, fileId: "file1", naturalWidth: 200, naturalHeight: 200 }));

    const restored = roundTrip(scene);
    expect(restored.getElements()).toEqual(scene.getElements());
    expect(restored.getFile("file1")).toEqual(scene.getFile("file1"));
  });

  it("preserves z-order (index) across the round trip", () => {
    const scene = new Scene();
    const a = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 5, height: 5 }));
    const b = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 5, height: 5 }));
    const c = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 5, height: 5 }));

    const restored = roundTrip(scene);
    expect(restored.getElements().map((el) => el.id)).toEqual([a.id, b.id, c.id]);
  });

  it("preserves version/versionNonce/updated exactly — a reload must not look like a fresh edit", () => {
    const scene = new Scene();
    const element = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 5, height: 5 }));
    scene.updateElement(element.id, { x: 99 });
    const edited = scene.getElement(element.id)!;

    const restored = roundTrip(scene);
    const restoredElement = restored.getElement(element.id)!;
    expect(restoredElement.version).toBe(edited.version);
    expect(restoredElement.versionNonce).toBe(edited.versionNonce);
    expect(restoredElement.updated).toBe(edited.updated);
  });
});

describe("serializeScene — export vs autosave soft-delete handling", () => {
  it("excludes soft-deleted elements by default (export mode)", () => {
    const scene = new Scene();
    const kept = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 5, height: 5 }));
    const deleted = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 5, height: 5 }));
    scene.deleteElement(deleted.id);

    const document = serializeScene(scene);
    expect(document.elements.map((el) => el.id)).toEqual([kept.id]);
  });

  it("keeps soft-deleted (tombstoned) elements when includeDeleted is true (autosave mode)", () => {
    const scene = new Scene();
    const kept = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 5, height: 5 }));
    const deleted = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 5, height: 5 }));
    scene.deleteElement(deleted.id);

    const document = serializeScene(scene, { includeDeleted: true });
    expect(document.elements.map((el) => el.id).sort()).toEqual([deleted.id, kept.id].sort());
    expect(document.elements.find((el) => el.id === deleted.id)?.isDeleted).toBe(true);
  });

  it("only includes files still referenced by an included (non-deleted, when exporting) image element", () => {
    const scene = new Scene();
    scene.addFile("orphan", { mimeType: "image/png", dataURL: "data:...", createdAt: 1 });
    scene.addFile("used", { mimeType: "image/png", dataURL: "data:...", createdAt: 2 });
    scene.addElement(createImageElement({ x: 0, y: 0, width: 5, height: 5, fileId: "used", naturalWidth: 5, naturalHeight: 5 }));

    const document = serializeScene(scene);
    expect(Object.keys(document.files)).toEqual(["used"]);
  });
});
