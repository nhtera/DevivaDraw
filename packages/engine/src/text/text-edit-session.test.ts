import { describe, expect, it, vi } from "vitest";
import { HistoryStack } from "../history/history-stack";
import type { AnyElement } from "../elements/element-types";
import { createTextElement } from "../elements/text-element";
import { Scene } from "../scene/scene";
import type { ShapeToolHistory } from "../tools/drag-shape-tool-base";
import { TextEditSession } from "./text-edit-session";

function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

/** `AnyElement`'s `text` field only exists on the `"text"` union member — narrow before reading it, same reasoning `freedraw-tool.ts` documents for its own type-specific-field writes. */
function textOf(scene: Scene, id: string): string | undefined {
  const element = scene.getElement(id);
  return element?.type === "text" ? element.text : undefined;
}

describe("TextEditSession", () => {
  it("starts idle and reports the editing element/draft once started", () => {
    const scene = new Scene();
    const element = scene.addElement(createTextElement({ x: 0, y: 0 }));
    const session = new TextEditSession({ scene, history: fakeHistory() });

    expect(session.getState()).toEqual({ status: "idle" });

    session.start({ elementId: element.id, initialText: "hi", isNewElement: false });

    expect(session.getState()).toEqual({ status: "editing", elementId: element.id, draftText: "hi", isNewElement: false });
  });

  it("opens a history batch on start", () => {
    const scene = new Scene();
    const element = scene.addElement(createTextElement({ x: 0, y: 0 }));
    const history = fakeHistory();
    const session = new TextEditSession({ scene, history });

    session.start({ elementId: element.id, initialText: "", isNewElement: true });

    expect(history.beginBatch).toHaveBeenCalledTimes(1);
  });

  it("updateDraft only updates local state — never touches Scene until commit (IME-safe)", () => {
    const scene = new Scene();
    const element = scene.addElement(createTextElement({ x: 0, y: 0, text: "" }));
    const session = new TextEditSession({ scene, history: fakeHistory() });

    session.start({ elementId: element.id, initialText: "", isNewElement: false });
    session.updateDraft("t");
    session.updateDraft("ty");
    session.updateDraft("typ");

    expect(session.getState()).toMatchObject({ draftText: "typ" });
    expect(textOf(scene, element.id)).toBe(""); // untouched until commit()
  });

  it("updateDraft before start() is a no-op (defensive guard)", () => {
    const scene = new Scene();
    const session = new TextEditSession({ scene, history: fakeHistory() });
    expect(() => session.updateDraft("x")).not.toThrow();
    expect(session.getState()).toEqual({ status: "idle" });
  });

  it("commit() writes the draft text into Scene and ends the history batch", () => {
    const scene = new Scene();
    const element = scene.addElement(createTextElement({ x: 0, y: 0, text: "old" }));
    const history = fakeHistory();
    const session = new TextEditSession({ scene, history });

    session.start({ elementId: element.id, initialText: "old", isNewElement: false });
    session.updateDraft("new text");
    session.commit();

    expect(textOf(scene, element.id)).toBe("new text");
    expect(history.endBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).toHaveBeenCalledWith(scene.getElements());
    expect(history.cancelBatch).not.toHaveBeenCalled();
    expect(session.getState()).toEqual({ status: "idle" });
  });

  it("commit() on a new element with only whitespace typed deletes it as one undoable step, not leaving a blank element", () => {
    const scene = new Scene();
    const element = scene.addElement(createTextElement({ x: 0, y: 0, text: "" }));
    const history = fakeHistory();
    const session = new TextEditSession({ scene, history });

    session.start({ elementId: element.id, initialText: "", isNewElement: true });
    session.updateDraft("   ");
    session.commit();

    expect(scene.getElement(element.id)?.isDeleted).toBe(true);
    expect(history.endBatch).toHaveBeenCalledTimes(1);
    expect(history.cancelBatch).not.toHaveBeenCalled();
  });

  it("commit() on an existing element edited down to empty deletes it too — no invisible zombie elements survive a commit", () => {
    const scene = new Scene();
    const element = scene.addElement(createTextElement({ x: 0, y: 0, text: "was here" }));
    const history = fakeHistory();
    const session = new TextEditSession({ scene, history });

    session.start({ elementId: element.id, initialText: "was here", isNewElement: false });
    session.updateDraft("");
    session.commit();

    expect(scene.getElement(element.id)?.isDeleted).toBe(true);
    expect(history.endBatch).toHaveBeenCalledTimes(1);
    expect(history.cancelBatch).not.toHaveBeenCalled();
  });

  it("commit() on an existing element edited down to whitespace-only also deletes it (whitespace counts as empty)", () => {
    const scene = new Scene();
    const element = scene.addElement(createTextElement({ x: 0, y: 0, text: "was here" }));
    const session = new TextEditSession({ scene, history: fakeHistory() });

    session.start({ elementId: element.id, initialText: "was here", isNewElement: false });
    session.updateDraft("   \n  ");
    session.commit();

    expect(scene.getElement(element.id)?.isDeleted).toBe(true);
  });

  it("cancel() on a new element deletes it and cancels the batch without writing the draft", () => {
    const scene = new Scene();
    const element = scene.addElement(createTextElement({ x: 0, y: 0, text: "" }));
    const history = fakeHistory();
    const session = new TextEditSession({ scene, history });

    session.start({ elementId: element.id, initialText: "", isNewElement: true });
    session.updateDraft("abandoned");
    session.cancel();

    expect(scene.getElement(element.id)?.isDeleted).toBe(true);
    expect(history.cancelBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).not.toHaveBeenCalled();
  });

  it("cancel() on an existing element leaves its original text untouched (nothing was ever written)", () => {
    const scene = new Scene();
    const element = scene.addElement(createTextElement({ x: 0, y: 0, text: "original" }));
    const session = new TextEditSession({ scene, history: fakeHistory() });

    session.start({ elementId: element.id, initialText: "original", isNewElement: false });
    session.updateDraft("edited but abandoned");
    session.cancel();

    expect(textOf(scene, element.id)).toBe("original");
    expect(session.getState()).toEqual({ status: "idle" });
  });

  it("commit()/cancel() before any start() is a no-op", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const session = new TextEditSession({ scene, history });

    expect(() => session.commit()).not.toThrow();
    expect(() => session.cancel()).not.toThrow();
    expect(history.endBatch).not.toHaveBeenCalled();
    expect(history.cancelBatch).not.toHaveBeenCalled();
  });

  it("onCommitted fires once after a successful commit with the final element id and text", () => {
    const scene = new Scene();
    const element = scene.addElement(createTextElement({ x: 0, y: 0 }));
    const session = new TextEditSession({ scene, history: fakeHistory() });
    const onCommitted = vi.fn();

    session.start({ elementId: element.id, initialText: "", isNewElement: false, onCommitted });
    session.updateDraft("final");
    session.commit();

    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(onCommitted).toHaveBeenCalledWith(element.id, "final");
  });

  it("onCommitted does not fire on cancel()", () => {
    const scene = new Scene();
    const element = scene.addElement(createTextElement({ x: 0, y: 0 }));
    const session = new TextEditSession({ scene, history: fakeHistory() });
    const onCommitted = vi.fn();

    session.start({ elementId: element.id, initialText: "", isNewElement: false, onCommitted });
    session.cancel();

    expect(onCommitted).not.toHaveBeenCalled();
  });

  it("subscribe() notifies on start/updateDraft/commit and the unsubscribe function stops delivery", () => {
    const scene = new Scene();
    const element = scene.addElement(createTextElement({ x: 0, y: 0 }));
    const session = new TextEditSession({ scene, history: fakeHistory() });
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);

    session.start({ elementId: element.id, initialText: "", isNewElement: false });
    session.updateDraft("x");
    session.commit();
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    session.start({ elementId: element.id, initialText: "", isNewElement: false });
    expect(listener).toHaveBeenCalledTimes(3); // no further calls after unsubscribe
  });

  it("end-to-end with a real HistoryStack: commit produces one undoable step, cancel produces none", () => {
    const scene = new Scene();
    const history = new HistoryStack<AnyElement[]>(scene.getElements());
    const committed = scene.addElement(createTextElement({ x: 0, y: 0, text: "" }));
    const abandoned = scene.addElement(createTextElement({ x: 0, y: 0, text: "" }));
    const session = new TextEditSession({ scene, history });

    session.start({ elementId: committed.id, initialText: "", isNewElement: true });
    session.updateDraft("kept");
    session.commit();
    expect(history.canUndo()).toBe(true);

    session.start({ elementId: abandoned.id, initialText: "", isNewElement: true });
    session.updateDraft("dropped");
    session.cancel();
    expect(history.isBatchOpen()).toBe(false);

    const undoneSnapshot = history.undo();
    expect(undoneSnapshot?.find((element) => element.id === committed.id)).toBeUndefined();
  });
});
