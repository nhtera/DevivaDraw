/**
 * `startBoundTextEdit` + `TextEditSession` integration: split out of `bound-text.test.ts` (which
 * covers the pure linking/layout units) purely to keep both files under the house line-count limit.
 */
import { describe, expect, it, vi } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import type { ShapeToolHistory } from "../tools/drag-shape-tool-base";
import { BOUND_TEXT_PADDING } from "./bound-text-layout";
import { findBoundTextRef, getOrCreateBoundText, startBoundTextEdit } from "./bound-text";
import { TextEditSession } from "./text-edit-session";
import { createFixedWidthTextMeasurer } from "./text-measurement";

function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

describe("startBoundTextEdit + TextEditSession integration", () => {
  const measurer = createFixedWidthTextMeasurer(10);

  it("committing bound text grows the container via the session's onCommitted hook", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 30 }));
    const session = new TextEditSession({ scene, history: fakeHistory() });

    startBoundTextEdit(scene, session, rect.id, measurer);
    session.updateDraft("aaaaaaaa bbbbbbbb"); // wraps to 2 lines at this container's width
    session.commit();

    expect(scene.getElement(rect.id)?.height).toBe(50 + BOUND_TEXT_PADDING * 2);
  });

  it("committing an empty bound-text draft deletes the (new) text element and unbinds it from the container", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 30 }));
    const session = new TextEditSession({ scene, history: fakeHistory() });

    startBoundTextEdit(scene, session, rect.id, measurer);
    session.commit(); // never typed anything

    const updatedRect = scene.getElement(rect.id);
    expect(findBoundTextRef(updatedRect!)).toBeNull();
    expect(updatedRect?.height).toBe(30); // untouched — nothing to grow for
  });

  it("editing an existing bound text a second time reuses it and re-runs the grow on commit", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 30 }));
    const session = new TextEditSession({ scene, history: fakeHistory() });

    startBoundTextEdit(scene, session, rect.id, measurer);
    session.updateDraft("first");
    session.commit();
    const firstTextId = findBoundTextRef(scene.getElement(rect.id)!)?.id;

    startBoundTextEdit(scene, session, rect.id, measurer);
    session.updateDraft("aaaaaaaa bbbbbbbb");
    session.commit();

    expect(findBoundTextRef(scene.getElement(rect.id)!)?.id).toBe(firstTextId);
    expect(scene.getElement(rect.id)?.height).toBe(50 + BOUND_TEXT_PADDING * 2);
  });

  it("cancelling a fresh bound-text edit leaves the container without a boundElements ref", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 30 }));
    const session = new TextEditSession({ scene, history: fakeHistory() });

    startBoundTextEdit(scene, session, rect.id, measurer);
    session.updateDraft("abandoned");
    session.cancel();

    // cancel() doesn't run onCommitted at all (see text-edit-session.test.ts), so the container's
    // stale ref is left pointing at the now-deleted draft — resolved lazily by getOrCreateBoundText's
    // own existing-ref-but-deleted fallback the next time this container is edited.
    const result = getOrCreateBoundText(scene, rect.id);
    expect(result.isNewElement).toBe(true);
    expect(result.initialText).toBe("");
  });

  it("editing an existing bound label down to empty deletes it and clears the container's boundElements ref (no zombie label)", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 30 }));
    const session = new TextEditSession({ scene, history: fakeHistory() });

    startBoundTextEdit(scene, session, rect.id, measurer);
    session.updateDraft("has a label");
    session.commit();
    const { textElementId } = getOrCreateBoundText(scene, rect.id);
    expect(findBoundTextRef(scene.getElement(rect.id)!)).not.toBeNull();

    startBoundTextEdit(scene, session, rect.id, measurer);
    session.updateDraft(""); // emptied out entirely
    session.commit();

    expect(scene.getElement(textElementId)?.isDeleted).toBe(true);
    expect(findBoundTextRef(scene.getElement(rect.id)!)).toBeNull();
  });

  it("re-invoking startBoundTextEdit for the same container mid-edit preserves the in-progress draft (double-click re-entrancy)", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 30 }));
    const session = new TextEditSession({ scene, history: fakeHistory() });

    startBoundTextEdit(scene, session, rect.id, measurer);
    session.updateDraft("typed so far");
    // A double-click's two single-click gestures (or any other double-invocation while the select
    // tool's own click handling also runs) both call this same entry point for the same container.
    startBoundTextEdit(scene, session, rect.id, measurer);

    expect(session.getState()).toMatchObject({ draftText: "typed so far" });

    session.commit();

    const boundRef = findBoundTextRef(scene.getElement(rect.id)!);
    expect(boundRef).not.toBeNull();
    expect(scene.getElement(boundRef!.id)).toMatchObject({ text: "typed so far", isDeleted: false });
  });
});
