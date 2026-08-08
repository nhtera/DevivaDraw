/**
 * `deserializeScene`'s dangling/invalid `containerId` repair — missing container, self-reference, and
 * wrong-element-type-bound (text bound to text) cases — split out of `deserialize-scene.test.ts` purely
 * to keep both files under the house line-count limit. See that file for the arrow-binding and
 * `boundElements` repair cases, which share the exact same `repairDanglingReferences` pass.
 */
import { describe, expect, it } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import { CURRENT_SCHEMA_VERSION, SCENE_DOCUMENT_TYPE } from "./scene-schema";
import { deserializeScene } from "./serialize-scene";

describe("deserializeScene — containerId repair", () => {
  it("clears a text element's containerId when it references a missing container", () => {
    const text = {
      ...createTextElement({ x: 0, y: 0, text: "hi", containerId: "missing-container" }),
      id: "text1", version: 1, versionNonce: 1, updated: 1, index: "a0",
    };
    const document = { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements: [text], files: {} };

    const result = deserializeScene(document);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const restored = result.scene.getElement("text1");
    if (restored?.type === "text") expect(restored.containerId).toBeNull();
  });

  it("clears a text element's containerId when it self-references (containerId === its own id)", () => {
    const text = { ...createTextElement({ x: 0, y: 0, text: "hi" }), id: "text-self", version: 1, versionNonce: 1, updated: 1, index: "a0" };
    const selfReferencing = { ...text, containerId: "text-self" };
    const document = { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements: [selfReferencing], files: {} };

    const result = deserializeScene(document);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const restored = result.scene.getElement("text-self");
    if (restored?.type === "text") expect(restored.containerId).toBeNull();
  });

  it("clears a text element's containerId when it references a non-container element (text bound to another text)", () => {
    const otherText = { ...createTextElement({ x: 0, y: 0, text: "target" }), id: "text-target", version: 1, versionNonce: 1, updated: 1, index: "a0" };
    const boundToText = {
      ...createTextElement({ x: 0, y: 0, text: "source", containerId: "text-target" }),
      id: "text-source", version: 1, versionNonce: 1, updated: 1, index: "a1",
    };
    const document = { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements: [otherText, boundToText], files: {} };

    const result = deserializeScene(document);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const restored = result.scene.getElement("text-source");
    if (restored?.type === "text") expect(restored.containerId).toBeNull();
    // The referenced text element itself must survive untouched — only the invalid ref is cleared.
    expect(result.scene.getElement("text-target")).toBeDefined();
  });

  it("keeps a text element's containerId when it references a real bindable container (rectangle/ellipse/diamond)", () => {
    const container = { ...createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }), id: "rect-container", version: 1, versionNonce: 1, updated: 1, index: "a0" };
    const bound = {
      ...createTextElement({ x: 0, y: 0, text: "label", containerId: "rect-container" }),
      id: "text-bound", version: 1, versionNonce: 1, updated: 1, index: "a1",
    };
    const document = { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements: [container, bound], files: {} };

    const result = deserializeScene(document);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const restored = result.scene.getElement("text-bound");
    if (restored?.type === "text") expect(restored.containerId).toBe("rect-container");
  });
});
