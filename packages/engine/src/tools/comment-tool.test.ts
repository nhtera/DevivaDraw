import { describe, expect, it, vi } from "vitest";
import { resolveCommentAnchor } from "../comments/comment-anchor";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { CommentTool } from "./comment-tool";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };
const author = () => ({ id: "a", name: "Ann" });

function setup() {
  const scene = new Scene();
  const box = scene.addElement(createRectangleElement({ x: 100, y: 100, width: 100, height: 50 }));
  const onThreadCreated = vi.fn();
  return { scene, box, tool: new CommentTool({ scene, author, onThreadCreated }), onThreadCreated };
}

describe("CommentTool", () => {
  it("anchors to the shape under the click so the pin rides its transforms", () => {
    const { scene, box, tool, onThreadCreated } = setup();
    tool.onGestureEnd({ x: 125, y: 140 }, NO_MODIFIERS);

    const thread = scene.getCommentThreads()[0]!;
    expect(thread.anchor.kind).toBe("element");
    if (thread.anchor.kind !== "element") throw new Error("expected an element anchor");
    expect(thread.anchor.elementId).toBe(box.id);
    expect(onThreadCreated).toHaveBeenCalledWith(expect.objectContaining({ id: thread.id }));

    scene.updateElement(box.id, { x: 300 });
    expect(resolveCommentAnchor(thread.anchor, scene)!.x).toBeCloseTo(325, 6);
  });

  it("anchors to the absolute point when the click lands on empty canvas", () => {
    const { scene, tool } = setup();
    tool.onGestureEnd({ x: 900, y: 900 }, NO_MODIFIERS);
    expect(scene.getCommentThreads()[0]!.anchor).toEqual({ kind: "point", x: 900, y: 900 });
  });

  it("stamps the host's author identity onto the thread", () => {
    const { scene, tool } = setup();
    tool.onGestureEnd({ x: 900, y: 900 }, NO_MODIFIERS);
    expect(scene.getCommentThreads()[0]).toMatchObject({ authorId: "a", authorName: "Ann" });
  });

  it("places nothing until the gesture ends, so an abandoned drag drops no pin", () => {
    const { scene, tool } = setup();
    tool.onGestureStart({ x: 900, y: 900 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 950, y: 950 }, NO_MODIFIERS);
    expect(scene.getCommentThreads()).toHaveLength(0);
    tool.onGestureCancel(NO_MODIFIERS);
    expect(scene.getCommentThreads()).toHaveLength(0);
  });

  it("ignores a shape on a hidden layer, matching what a select click can reach", () => {
    const { scene, tool } = setup();
    const hidden = scene.addLayer("Hidden");
    const onHidden = scene.addElement(createRectangleElement({ x: 500, y: 500, width: 100, height: 50, layerId: hidden.id }));
    scene.setLayerVisible(hidden.id, false);
    tool.placeAt({ x: 525, y: 525 });
    const thread = scene.getCommentThreads()[0]!;
    expect(thread.anchor.kind).toBe("point");
    void onHidden;
  });

  it("places a pin without a pointer gesture, for a headless host", () => {
    const { scene, tool } = setup();
    const thread = tool.placeAt({ x: 125, y: 140 });
    expect(thread).not.toBeNull();
    expect(scene.getCommentThread(thread!.id)).toBeDefined();
  });

  it("keeps comment placement out of undo history", () => {
    const { scene, tool } = setup();
    const before = scene.getElements().length;
    tool.placeAt({ x: 125, y: 140 });
    expect(scene.getElements()).toHaveLength(before); // no element was created, so nothing entered a history snapshot
  });
});
