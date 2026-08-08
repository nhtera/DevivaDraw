import { describe, expect, it, vi } from "vitest";
import { Scene } from "../scene/scene";
import { TextEditSession } from "../text/text-edit-session";
import { createFixedWidthTextMeasurer } from "../text/text-measurement";
import type { ShapeToolHistory } from "./drag-shape-tool-base";
import { ShapeStyleState } from "./shape-style-state";
import { TextTool } from "./text-tool";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

/** `AnyElement`'s `text` field only exists on the `"text"` union member — narrow before reading it, same reasoning `freedraw-tool.ts` documents for its own type-specific-field writes. */
function textOf(scene: Scene, id: string): string | undefined {
  const element = scene.getElement(id);
  return element?.type === "text" ? element.text : undefined;
}

function setup() {
  const scene = new Scene();
  const styleState = new ShapeStyleState({ strokeColor: "#00ff00" });
  const editSession = new TextEditSession({ scene, history: fakeHistory() });
  const measurer = createFixedWidthTextMeasurer(10);
  const onPlaced = vi.fn();
  const tool = new TextTool({ scene, styleState, editSession, measurer, onPlaced });
  return { scene, editSession, tool, onPlaced };
}

describe("TextTool", () => {
  it("creates an empty TextElement at the click point, styled from the current style state", () => {
    const { scene, tool } = setup();

    tool.onGestureStart({ x: 15, y: 25 }, NO_MODIFIERS);

    const elements = scene.getElements();
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({ type: "text", x: 15, y: 25, text: "", strokeColor: "#00ff00" });
  });

  it("opens an edit session for the new element as isNewElement", () => {
    const { scene, editSession, tool } = setup();

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);

    const element = scene.getElements()[0];
    expect(editSession.getState()).toMatchObject({ status: "editing", elementId: element?.id, isNewElement: true });
  });

  it("does not call onPlaced from onGestureStart alone — the gesture (click) is still in progress", () => {
    const { tool, onPlaced } = setup();

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);

    expect(onPlaced).not.toHaveBeenCalled();
  });

  it("calls onPlaced with the new element's id once the gesture ends (pointerup)", () => {
    const { scene, tool, onPlaced } = setup();

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS);

    const element = scene.getElements()[0];
    expect(onPlaced).toHaveBeenCalledWith(element?.id);
  });

  it("onGestureEnd with no prior onGestureStart does not call onPlaced", () => {
    const { tool, onPlaced } = setup();

    tool.onGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS);

    expect(onPlaced).not.toHaveBeenCalled();
  });

  it("committing the session syncs width/height to the natural (unwrapped) measured size", () => {
    const { scene, editSession, tool } = setup();

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    const elementId = scene.getElements()[0]?.id as string;
    editSession.updateDraft("hello world"); // 11 chars * 10px = 110px at the fixed-width measurer
    editSession.commit();

    const element = scene.getElement(elementId);
    expect(textOf(scene, elementId)).toBe("hello world");
    expect(element?.width).toBe(110);
    expect(element?.height).toBeGreaterThan(0);
  });

  it("committing with no text leaves no live element (discard-if-empty)", () => {
    const { scene, editSession, tool } = setup();

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    editSession.commit(); // never typed anything

    expect(scene.getElements().filter((el) => !el.isDeleted)).toHaveLength(0);
  });

  it("each click places an independent new text element", () => {
    const { scene, editSession, tool } = setup();

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    editSession.updateDraft("first");
    editSession.commit();

    tool.onGestureStart({ x: 50, y: 50 }, NO_MODIFIERS);
    editSession.updateDraft("second");
    editSession.commit();

    const liveElements = scene.getElements().filter((el) => !el.isDeleted);
    expect(liveElements).toHaveLength(2);
    expect(liveElements.map((el) => (el.type === "text" ? el.text : undefined))).toEqual(["first", "second"]);
  });
});
