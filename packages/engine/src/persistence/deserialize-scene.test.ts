/**
 * `deserializeScene`'s malformed-input rejection and dangling-reference repair behavior — split out
 * from `serialize-scene.test.ts` (which covers the happy-path round trip and `serializeScene`'s own
 * export-vs-autosave options) purely to keep both files under the house line-count limit.
 */
import { describe, expect, it } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { createImageElement } from "../elements/image-element";
import { createRectangleElement } from "../elements/shape-elements";
import { bindArrowEndpoint } from "../bindings/binding-model";
import { Scene } from "../scene/scene";
import { CURRENT_SCHEMA_VERSION, SCENE_DOCUMENT_TYPE } from "./scene-schema";
import { deserializeScene, serializeScene } from "./serialize-scene";

function roundTrip(scene: Scene) {
  const document = serializeScene(scene);
  const parsed = JSON.parse(JSON.stringify(document));
  const result = deserializeScene(parsed);
  if (!result.ok) throw new Error(`round trip failed: ${result.error}`);
  return result.scene;
}

describe("deserializeScene — malformed input never crashes, never throws", () => {
  it("rejects a completely unrelated JSON value", () => {
    expect(deserializeScene({ hello: "world" }).ok).toBe(false);
    expect(deserializeScene("just a string").ok).toBe(false);
    expect(deserializeScene(null).ok).toBe(false);
    expect(deserializeScene(undefined).ok).toBe(false);
    expect(deserializeScene(42).ok).toBe(false);
    expect(deserializeScene([1, 2, 3]).ok).toBe(false);
  });

  it("rejects a document with a non-numeric/zero/negative schemaVersion", () => {
    expect(deserializeScene({ type: SCENE_DOCUMENT_TYPE, schemaVersion: "1", elements: [], files: {} }).ok).toBe(false);
    expect(deserializeScene({ type: SCENE_DOCUMENT_TYPE, schemaVersion: 0, elements: [], files: {} }).ok).toBe(false);
    expect(deserializeScene({ type: SCENE_DOCUMENT_TYPE, schemaVersion: -1, elements: [], files: {} }).ok).toBe(false);
  });

  it("rejects a document from a newer, unsupported schema version rather than guessing a downgrade", () => {
    const future = { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION + 1, elements: [], files: {} };
    const result = deserializeScene(future);
    expect(result.ok).toBe(false);
  });

  it("rejects a document with a structurally invalid element without throwing", () => {
    const malformed = { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements: [{ id: "x" }], files: {} };
    expect(() => deserializeScene(malformed)).not.toThrow();
    expect(deserializeScene(malformed).ok).toBe(false);
  });

  it("never partially populates a scene on rejection — an ok:false result carries no scene at all", () => {
    const malformed = {
      type: SCENE_DOCUMENT_TYPE,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      elements: [{ id: "bad-element" }],
      files: {},
    };
    const result = deserializeScene(malformed);
    expect(result.ok).toBe(false);
    expect("scene" in result).toBe(false);
  });

  it("handles a deeply corrupted/adversarial payload (circular-looking, huge nested junk) without throwing", () => {
    const junk: Record<string, unknown> = { type: SCENE_DOCUMENT_TYPE, schemaVersion: 1, elements: null, files: null };
    expect(() => deserializeScene(junk)).not.toThrow();
    expect(deserializeScene(junk).ok).toBe(false);
  });

  it("rejects two elements sharing the same id — cleanly (ok:false), never throws, and never touches an existing live scene", () => {
    const duplicateId = "dup-1";
    const first = { ...createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }), id: duplicateId, version: 1, versionNonce: 1, updated: 1, index: "a0" };
    const second = { ...createRectangleElement({ x: 5, y: 5, width: 10, height: 10 }), id: duplicateId, version: 1, versionNonce: 1, updated: 1, index: "a1" };
    const document = { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements: [first, second], files: {} };

    // An unrelated, already-live scene the app would already be showing — must remain completely
    // unaffected by a rejected deserialize call happening elsewhere (e.g. a background "open file"
    // attempt), same invariant `scene.ts`'s `Scene.fromJSON` doc calls out for its static-factory shape.
    const liveScene = new Scene();
    const liveElement = liveScene.addElement(createRectangleElement({ x: 1, y: 1, width: 1, height: 1 }));

    expect(() => deserializeScene(document)).not.toThrow();
    const result = deserializeScene(document);
    expect(result.ok).toBe(false);
    expect("scene" in result).toBe(false);

    expect(liveScene.getElements()).toEqual([liveElement]);
  });
});

describe("deserializeScene — negative width/height rejected end-to-end (never silently corrupts bounds)", () => {
  it("rejects a document containing an element with a negative width", () => {
    const negative = { ...createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }), width: -50, version: 1, versionNonce: 1, updated: 1, index: "a0" };
    const document = { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements: [negative], files: {} };
    expect(deserializeScene(document).ok).toBe(false);
  });

  it("rejects a document containing an element with a negative height", () => {
    const negative = { ...createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }), height: -50, version: 1, versionNonce: 1, updated: 1, index: "a0" };
    const document = { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements: [negative], files: {} };
    expect(deserializeScene(document).ok).toBe(false);
  });

  it("rejects a document containing an image element with a negative naturalWidth/naturalHeight", () => {
    const negativeNaturalWidth = {
      ...createImageElement({ x: 0, y: 0, fileId: "f1", naturalWidth: 10, naturalHeight: 10 }),
      naturalWidth: -10, version: 1, versionNonce: 1, updated: 1, index: "a0",
    };
    const document = { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements: [negativeNaturalWidth], files: {} };
    expect(deserializeScene(document).ok).toBe(false);
  });
});

describe("deserializeScene — dangling-reference repair", () => {
  it("clears an arrow's startBinding/endBinding that reference a missing element id", () => {
    const document = {
      type: SCENE_DOCUMENT_TYPE,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      elements: [
        {
          ...createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }),
          id: "arrow1", version: 1, versionNonce: 1, updated: 1, index: "a0",
          startBinding: { elementId: "does-not-exist", focus: 0, gap: 4 },
          endBinding: { elementId: "also-missing", focus: 0, gap: 4 },
        },
      ],
      files: {},
    };
    const result = deserializeScene(document);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const arrow = result.scene.getElement("arrow1");
    expect(arrow?.type).toBe("arrow");
    if (arrow?.type === "arrow") {
      expect(arrow.startBinding).toBeNull();
      expect(arrow.endBinding).toBeNull();
    }
  });

  it("keeps an arrow binding that references a real element in the same document", () => {
    const shape = { ...createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }), id: "shape1", version: 1, versionNonce: 1, updated: 1, index: "a0" };
    const arrow = {
      ...createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }),
      id: "arrow1", version: 1, versionNonce: 1, updated: 1, index: "a1",
      startBinding: { elementId: "shape1", focus: 0, gap: 4 },
    };
    const document = { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements: [shape, arrow], files: {} };

    const result = deserializeScene(document);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const restoredArrow = result.scene.getElement("arrow1");
    if (restoredArrow?.type === "arrow") expect(restoredArrow.startBinding?.elementId).toBe("shape1");
  });

  // Container-id-specific repair cases (missing container / self-reference / wrong element type) live
  // in `deserialize-scene-containerid-repair.test.ts` — split out purely for the house line-count limit.

  it("filters boundElements entries that reference a missing element id", () => {
    const rect = {
      ...createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }),
      id: "rect1", version: 1, versionNonce: 1, updated: 1, index: "a0",
      boundElements: [{ id: "gone", type: "arrow" }, { id: "also-gone", type: "text" }],
    };
    const document = { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements: [rect], files: {} };

    const result = deserializeScene(document);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.getElement("rect1")?.boundElements).toEqual([]);
  });

  it("does not repair anything (no version bumps) for a well-formed document with only valid, live references", () => {
    const scene = new Scene();
    const rect1 = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    const rect2 = scene.addElement(createRectangleElement({ x: 100, y: 0, width: 40, height: 40 }));
    const arrow = scene.addElement(createArrowElement({ x: 20, y: 20, points: [{ x: 0, y: 0 }, { x: 80, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", rect1.id, { focus: 0, gap: 4 });
    bindArrowEndpoint(scene, arrow.id, "end", rect2.id, { focus: 0, gap: 4 });
    const beforeVersions = new Map(scene.getElements().map((el) => [el.id, el.version]));

    const restored = roundTrip(scene);
    for (const element of restored.getElements()) {
      expect(element.version).toBe(beforeVersions.get(element.id));
    }
  });
});
