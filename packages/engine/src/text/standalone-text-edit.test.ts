import { describe, expect, it, vi } from "vitest";
import { createTextElement } from "../elements/text-element";
import { Scene } from "../scene/scene";
import type { ShapeToolHistory } from "../tools/drag-shape-tool-base";
import { startExistingStandaloneTextEdit, startStandaloneTextEdit } from "./standalone-text-edit";
import { TextEditSession } from "./text-edit-session";
import { createFixedWidthTextMeasurer } from "./text-measurement";

function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

const measurer = createFixedWidthTextMeasurer(10);

describe("startStandaloneTextEdit", () => {
  it("adds an empty text element at the point and opens a new-element edit session on it", () => {
    const scene = new Scene();
    const session = new TextEditSession({ scene, history: fakeHistory() });

    const id = startStandaloneTextEdit(scene, session, measurer, { x: 40, y: 60 }, { strokeColor: "#111", opacity: 100 });

    const element = scene.getElement(id);
    expect(element).toMatchObject({ type: "text", x: 40, y: 60, text: "" });
    expect(session.getState()).toEqual({ status: "editing", elementId: id, draftText: "", isNewElement: true });
  });
});

describe("startExistingStandaloneTextEdit", () => {
  it("re-opens editing on an existing text element seeded with its current text (not a new element)", () => {
    const scene = new Scene();
    const element = scene.addElement(createTextElement({ x: 40, y: 60, text: "sss" }));
    const session = new TextEditSession({ scene, history: fakeHistory() });

    startExistingStandaloneTextEdit(scene, session, measurer, element.id);

    // Same element edited in place (its id, seeded draft), and isNewElement:false so an Escape leaves it intact.
    expect(session.getState()).toEqual({ status: "editing", elementId: element.id, draftText: "sss", isNewElement: false });
    expect(scene.getElements().filter((e) => !e.isDeleted && e.type === "text")).toHaveLength(1); // no duplicate spawned
  });

  it("is a no-op for a missing or non-text element (never opens a session)", () => {
    const scene = new Scene();
    const session = new TextEditSession({ scene, history: fakeHistory() });

    startExistingStandaloneTextEdit(scene, session, measurer, "does-not-exist");

    expect(session.getState()).toEqual({ status: "idle" });
  });
});
