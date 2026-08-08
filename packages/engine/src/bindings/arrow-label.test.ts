import { describe, expect, it, vi } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import type { TextElement } from "../elements/text-element";
import { Scene } from "../scene/scene";
import { createFixedWidthTextMeasurer } from "../text/text-measurement";
import type { ShapeToolHistory } from "../tools/drag-shape-tool-base";
import { TextEditSession } from "../text/text-edit-session";
import { getOrCreateArrowLabel, recenterArrowLabelIfPresent, startArrowLabelEdit } from "./arrow-label";

function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

function setupArrow(scene: Scene) {
  return scene.addElement(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }));
}

describe("getOrCreateArrowLabel", () => {
  it("creates an empty, centered, middle-aligned text element bound to the arrow", () => {
    const scene = new Scene();
    const arrow = setupArrow(scene);

    const result = getOrCreateArrowLabel(scene, arrow.id);

    expect(result.isNewElement).toBe(true);
    expect(result.initialText).toBe("");
    const text = scene.getElement(result.textElementId);
    expect(text?.type).toBe("text");
    if (text?.type === "text") {
      expect(text.containerId).toBe(arrow.id);
      expect(text.textAlign).toBe("center");
      expect(text.verticalAlign).toBe("middle");
      // Centered on the arrow's midpoint (50, 0) — text x/y offset by 0 since width/height start at 0.
      expect(text.x).toBeCloseTo(50);
      expect(text.y).toBeCloseTo(0);
    }
    expect(scene.getElement(arrow.id)?.boundElements).toEqual([{ id: result.textElementId, type: "text" }]);
  });

  it("returns the existing label on a second call instead of creating a duplicate", () => {
    const scene = new Scene();
    const arrow = setupArrow(scene);
    const first = getOrCreateArrowLabel(scene, arrow.id);
    const second = getOrCreateArrowLabel(scene, arrow.id);

    expect(second.textElementId).toBe(first.textElementId);
    expect(second.isNewElement).toBe(false);
  });

  it("throws for a missing or non-arrow id (caller bug guard)", () => {
    const scene = new Scene();
    expect(() => getOrCreateArrowLabel(scene, "does-not-exist")).toThrow();
  });
});

describe("recenterArrowLabelIfPresent", () => {
  it("moves the label to the arrow's new midpoint after its geometry changes", () => {
    const scene = new Scene();
    const arrow = setupArrow(scene);
    const { textElementId } = getOrCreateArrowLabel(scene, arrow.id);
    scene.updateElement(textElementId, { text: "hi" } as Partial<TextElement>);

    scene.updateElement(arrow.id, { x: 1000, y: 1000 });
    recenterArrowLabelIfPresent(scene, arrow.id, createFixedWidthTextMeasurer(6));

    const text = scene.getElement(textElementId);
    if (text?.type === "text") {
      expect(text.x).toBeCloseTo(1050 - text.width / 2, 0);
      expect(text.y).toBeCloseTo(1000 - text.height / 2, 0);
    }
  });

  it("no-ops for an arrow with no bound label", () => {
    const scene = new Scene();
    const arrow = setupArrow(scene);
    expect(() => recenterArrowLabelIfPresent(scene, arrow.id, createFixedWidthTextMeasurer(6))).not.toThrow();
  });

  it("no-ops for a deleted arrow", () => {
    const scene = new Scene();
    const arrow = setupArrow(scene);
    scene.deleteElement(arrow.id);
    expect(() => recenterArrowLabelIfPresent(scene, arrow.id, createFixedWidthTextMeasurer(6))).not.toThrow();
  });
});

describe("startArrowLabelEdit — session integration", () => {
  it("opens an edit session for a freshly created label and commits normally", () => {
    const scene = new Scene();
    const arrow = setupArrow(scene);
    const session = new TextEditSession({ scene, history: fakeHistory() });

    startArrowLabelEdit(scene, session, arrow.id, createFixedWidthTextMeasurer(6));
    expect(session.getState().status).toBe("editing");

    session.updateDraft("hello");
    session.commit();

    const state = session.getState();
    expect(state.status).toBe("idle");
    const labelRef = scene.getElement(arrow.id)?.boundElements?.[0];
    const label = labelRef ? scene.getElement(labelRef.id) : undefined;
    expect(label?.type).toBe("text");
    if (label?.type === "text") expect(label.text).toBe("hello");
  });

  it("committing an empty draft unbinds the label instead of leaving a blank one", () => {
    const scene = new Scene();
    const arrow = setupArrow(scene);
    const session = new TextEditSession({ scene, history: fakeHistory() });

    startArrowLabelEdit(scene, session, arrow.id, createFixedWidthTextMeasurer(6));
    session.commit(); // empty draft — commit() itself deletes the element

    expect(scene.getElement(arrow.id)?.boundElements).toEqual([]);
  });
});
