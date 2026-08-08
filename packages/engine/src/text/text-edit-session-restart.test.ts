/**
 * `start()`'s re-entrancy behavior: split out of `text-edit-session.test.ts` (which covers the
 * rest of the lifecycle) purely to keep both files under the house line-count limit.
 */
import { describe, expect, it, vi } from "vitest";
import { createTextElement } from "../elements/text-element";
import { Scene } from "../scene/scene";
import type { ShapeToolHistory } from "../tools/drag-shape-tool-base";
import { TextEditSession } from "./text-edit-session";

function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

/** `AnyElement`'s `text` field only exists on the `"text"` union member — narrow before reading it. */
function textOf(scene: Scene, id: string): string | undefined {
  const element = scene.getElement(id);
  return element?.type === "text" ? element.text : undefined;
}

describe("TextEditSession.start() re-entrancy", () => {
  it("starting the same elementId while it's already editing is a no-op — preserves the draft instead of cancel-then-restart", () => {
    const scene = new Scene();
    const element = scene.addElement(createTextElement({ x: 0, y: 0, text: "" }));
    const history = fakeHistory();
    const session = new TextEditSession({ scene, history });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    session.start({ elementId: element.id, initialText: "", isNewElement: true });
    session.updateDraft("in progress");
    // Simulates a double-click's two single-click gestures both re-invoking the same
    // start-editing entry point for the element already being typed into.
    session.start({ elementId: element.id, initialText: "", isNewElement: true });

    expect(session.getState()).toMatchObject({ elementId: element.id, draftText: "in progress" });
    expect(scene.getElement(element.id)?.isDeleted).toBe(false); // never cancelled/deleted mid-type
    expect(history.beginBatch).toHaveBeenCalledTimes(1); // only the original start opened a batch
    expect(warnSpy).not.toHaveBeenCalled(); // same-element re-start isn't the caller-bug case

    warnSpy.mockRestore();
  });

  it("committing after a same-element re-start writes the (preserved) draft normally", () => {
    const scene = new Scene();
    const element = scene.addElement(createTextElement({ x: 0, y: 0, text: "" }));
    const session = new TextEditSession({ scene, history: fakeHistory() });

    session.start({ elementId: element.id, initialText: "", isNewElement: true });
    session.updateDraft("in progress");
    session.start({ elementId: element.id, initialText: "", isNewElement: true });
    session.commit();

    expect(scene.getElement(element.id)?.isDeleted).toBe(false);
    expect(textOf(scene, element.id)).toBe("in progress");
  });

  it("starting a DIFFERENT elementId while one is open still cancels the first (loud recovery, not silent data loss)", () => {
    const scene = new Scene();
    const first = scene.addElement(createTextElement({ x: 0, y: 0, text: "" }));
    const second = scene.addElement(createTextElement({ x: 0, y: 0, text: "" }));
    const history = fakeHistory();
    const session = new TextEditSession({ scene, history });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    session.start({ elementId: first.id, initialText: "", isNewElement: true });
    session.updateDraft("abandoned");
    session.start({ elementId: second.id, initialText: "", isNewElement: true });

    expect(scene.getElement(first.id)?.isDeleted).toBe(true); // the abandoned new-element draft was discarded
    expect(session.getState()).toMatchObject({ elementId: second.id });
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});
