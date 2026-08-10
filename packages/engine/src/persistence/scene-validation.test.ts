import { describe, expect, it } from "vitest";
import type { AnyElement } from "../elements/element-types";
import { createArrowElement } from "../elements/arrow-element";
import { createFreedrawElement } from "../elements/freedraw-element";
import { createImageElement } from "../elements/image-element";
import { createDiamondElement, createEllipseElement, createLineElement, createRectangleElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import { touch } from "../scene/scene-mutations";
import { CURRENT_SCHEMA_VERSION, SCENE_DOCUMENT_TYPE } from "./scene-schema";
import { validateSceneDocument } from "./scene-validation";

/** A freshly-created element has store-owned sentinel fields (`version: 0`, `index: ""`) that only a real `Scene.addElement` normally fixes up — `touch()` mirrors that, matching what `serializeScene` actually emits. */
function stored<T extends AnyElement>(element: T): T {
  return touch(element, { index: "a0" } as Partial<T>);
}

function minimalDocument(elements: unknown[] = [], files: Record<string, unknown> = {}) {
  return { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements, files };
}

describe("validateSceneDocument — envelope", () => {
  it("accepts an empty, well-formed document", () => {
    const result = validateSceneDocument(minimalDocument());
    expect(result.ok).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(validateSceneDocument("just a string").ok).toBe(false);
    expect(validateSceneDocument(null).ok).toBe(false);
    expect(validateSceneDocument(42).ok).toBe(false);
    expect(validateSceneDocument([1, 2, 3]).ok).toBe(false);
  });

  it("rejects a document with the wrong type discriminator", () => {
    const result = validateSceneDocument({ ...minimalDocument(), type: "some-other-format" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/"type"/);
  });

  it("rejects a document whose schemaVersion isn't the current version", () => {
    const result = validateSceneDocument({ ...minimalDocument(), schemaVersion: 99 });
    expect(result.ok).toBe(false);
  });

  it("rejects when elements is not an array", () => {
    const result = validateSceneDocument({ ...minimalDocument(), elements: "not an array" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/"elements"/);
  });

  it("rejects when files is not an object", () => {
    const result = validateSceneDocument({ ...minimalDocument(), files: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/"files"/);
  });

  it("accepts a well-formed appState and rejects a malformed one", () => {
    expect(validateSceneDocument({ ...minimalDocument(), appState: { scrollX: 1, scrollY: 2, zoom: 1.5 } }).ok).toBe(true);
    expect(validateSceneDocument({ ...minimalDocument(), appState: { scrollX: "nope" } }).ok).toBe(false);
    expect(validateSceneDocument({ ...minimalDocument(), appState: "nope" }).ok).toBe(false);
  });

  it("validates every file entry's shape", () => {
    const good = validateSceneDocument(minimalDocument([], { f1: { mimeType: "image/png", dataURL: "data:...", createdAt: 1 } }));
    expect(good.ok).toBe(true);
    const bad = validateSceneDocument(minimalDocument([], { f1: { mimeType: "image/png" } }));
    expect(bad.ok).toBe(false);
  });
});

describe("validateSceneDocument — per-element-type structural validation", () => {
  const factories: Array<[string, () => unknown]> = [
    ["generic", () => stored({ ...createRectangleElement({ x: 0, y: 0 }), type: "generic" })],
    ["rectangle", () => stored(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }))],
    ["ellipse", () => stored(createEllipseElement({ x: 0, y: 0, width: 10, height: 10 }))],
    ["diamond", () => stored(createDiamondElement({ x: 0, y: 0, width: 10, height: 10 }))],
    ["line", () => stored(createLineElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }))],
    ["freedraw", () => stored(createFreedrawElement({ x: 0, y: 0, points: [[0, 0, 0.5]] }))],
    ["text", () => stored(createTextElement({ x: 0, y: 0, text: "hi" }))],
    ["arrow", () => stored(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }))],
    ["image", () => stored(createImageElement({ x: 0, y: 0, fileId: "f1", naturalWidth: 10, naturalHeight: 10 }))],
  ];

  for (const [typeName, build] of factories) {
    it(`accepts a well-formed "${typeName}" element`, () => {
      const result = validateSceneDocument(minimalDocument([build()]));
      expect(result.ok).toBe(true);
    });
  }

  it("rejects an element that isn't an object", () => {
    const result = validateSceneDocument(minimalDocument(["not an object"]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/elements\[0\]/);
  });

  it("rejects an element with an unrecognized type", () => {
    const element = { ...stored(createRectangleElement({ x: 0, y: 0 })), type: "octagon" };
    expect(validateSceneDocument(minimalDocument([element])).ok).toBe(false);
  });

  it("rejects an element missing a required base field", () => {
    // `stored()` freezes (see `scene-mutations.ts`'s `touch`) — spread into a fresh, mutable plain
    // object before deleting a field, matching how a real `Scene`-stored element behaves.
    const element: Record<string, unknown> = { ...stored(createRectangleElement({ x: 0, y: 0 })) };
    delete element.strokeColor;
    expect(validateSceneDocument(minimalDocument([element])).ok).toBe(false);
  });

  it("rejects an element with a wrong-typed base field", () => {
    const element = { ...stored(createRectangleElement({ x: 0, y: 0 })), opacity: "100" };
    expect(validateSceneDocument(minimalDocument([element])).ok).toBe(false);
  });

  it("rejects a negative width or height — a hand-edited negative size must not silently corrupt export bounds", () => {
    const negativeWidth = { ...stored(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 })), width: -50 };
    expect(validateSceneDocument(minimalDocument([negativeWidth])).ok).toBe(false);

    const negativeHeight = { ...stored(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 })), height: -50 };
    expect(validateSceneDocument(minimalDocument([negativeHeight])).ok).toBe(false);
  });

  it("accepts a zero width or height (degenerate but not negative)", () => {
    const zeroWidth = { ...stored(createRectangleElement({ x: 0, y: 0, width: 0, height: 10 })) };
    expect(validateSceneDocument(minimalDocument([zeroWidth])).ok).toBe(true);
  });

  it("rejects a negative naturalWidth or naturalHeight on an image element", () => {
    const negativeNaturalWidth = { ...stored(createImageElement({ x: 0, y: 0, fileId: "f1", naturalWidth: 10, naturalHeight: 10 })), naturalWidth: -10 };
    expect(validateSceneDocument(minimalDocument([negativeNaturalWidth])).ok).toBe(false);

    const negativeNaturalHeight = { ...stored(createImageElement({ x: 0, y: 0, fileId: "f1", naturalWidth: 10, naturalHeight: 10 })), naturalHeight: -10 };
    expect(validateSceneDocument(minimalDocument([negativeNaturalHeight])).ok).toBe(false);
  });

  it("rejects an out-of-enum fillStyle/strokeStyle", () => {
    const badFill = { ...stored(createRectangleElement({ x: 0, y: 0 })), fillStyle: "sparkles" };
    expect(validateSceneDocument(minimalDocument([badFill])).ok).toBe(false);
    const badStroke = { ...stored(createRectangleElement({ x: 0, y: 0 })), strokeStyle: "glowing" };
    expect(validateSceneDocument(minimalDocument([badStroke])).ok).toBe(false);
  });

  it("rejects malformed roundness (not null and not {type: number})", () => {
    const element = { ...stored(createRectangleElement({ x: 0, y: 0 })), roundness: { type: "not-a-number" } };
    expect(validateSceneDocument(minimalDocument([element])).ok).toBe(false);
  });

  it("rejects malformed groupIds (not a string array)", () => {
    const element = { ...stored(createRectangleElement({ x: 0, y: 0 })), groupIds: [1, 2, 3] };
    expect(validateSceneDocument(minimalDocument([element])).ok).toBe(false);
  });

  it("rejects malformed boundElements entries", () => {
    const element = { ...stored(createRectangleElement({ x: 0, y: 0 })), boundElements: [{ id: "x" }] };
    expect(validateSceneDocument(minimalDocument([element])).ok).toBe(false);
  });

  it("rejects a line/arrow with fewer points than required", () => {
    const badLine = { ...stored(createLineElement({ x: 0, y: 0, points: [] })) };
    expect(validateSceneDocument(minimalDocument([badLine])).ok).toBe(false);

    const badArrow = { ...stored(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }] })) };
    expect(validateSceneDocument(minimalDocument([badArrow])).ok).toBe(false);
  });

  it("rejects a freedraw element whose points aren't [x, y, pressure] tuples", () => {
    const element = { ...stored(createFreedrawElement({ x: 0, y: 0, points: [[0, 0, 0.5]] })), points: [[0, 0]] };
    expect(validateSceneDocument(minimalDocument([element])).ok).toBe(false);
  });

  it("rejects a malformed arrow binding", () => {
    const element = { ...stored(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })), startBinding: { elementId: "x" } };
    expect(validateSceneDocument(minimalDocument([element])).ok).toBe(false);
  });

  it("accepts a valid arrow binding", () => {
    const element = {
      ...stored(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })),
      startBinding: { elementId: "shape1", focus: 0, gap: 4 },
    };
    expect(validateSceneDocument(minimalDocument([element])).ok).toBe(true);
  });

  it("rejects an out-of-enum arrowhead/arrowType", () => {
    const badHead = { ...stored(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })), startArrowhead: "laser" };
    expect(validateSceneDocument(minimalDocument([badHead])).ok).toBe(false);
    const badType = { ...stored(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })), arrowType: "zigzag" };
    expect(validateSceneDocument(minimalDocument([badType])).ok).toBe(false);
  });

  it("rejects a text element with an out-of-enum textAlign/verticalAlign/fontFamily", () => {
    const base = stored(createTextElement({ x: 0, y: 0, text: "hi" }));
    expect(validateSceneDocument(minimalDocument([{ ...base, textAlign: "justified" }])).ok).toBe(false);
    expect(validateSceneDocument(minimalDocument([{ ...base, verticalAlign: "middleish" }])).ok).toBe(false);
    expect(validateSceneDocument(minimalDocument([{ ...base, fontFamily: "comic-sans" }])).ok).toBe(false);
  });

  it("rejects a text element with a non-string/non-null containerId", () => {
    const element = { ...stored(createTextElement({ x: 0, y: 0, text: "hi" })), containerId: 123 };
    expect(validateSceneDocument(minimalDocument([element])).ok).toBe(false);
  });

  it("rejects an image element missing fileId/naturalWidth/naturalHeight", () => {
    const element: Record<string, unknown> = { ...stored(createImageElement({ x: 0, y: 0, fileId: "f1", naturalWidth: 10, naturalHeight: 10 })) };
    delete element.fileId;
    expect(validateSceneDocument(minimalDocument([element])).ok).toBe(false);
  });

  it("reports the index of the failing element for a multi-element document", () => {
    const good = stored(createRectangleElement({ x: 0, y: 0 }));
    const bad = { ...stored(createRectangleElement({ x: 0, y: 0 })), opacity: "oops" };
    const result = validateSceneDocument(minimalDocument([good, bad]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/elements\[1\]/);
  });
});
