import { describe, expect, it } from "vitest";
import { anchorForElementPoint } from "../comments/comment-anchor";
import { createCommentMessage, createCommentThread, MAX_COMMENT_MESSAGES_PER_THREAD, MAX_COMMENT_THREADS } from "../comments/comment-types";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { deserializeMultiPageDocument, serializeMultiPageDocument } from "./multi-page-document";
import { deserializeScene, deserializeSceneLenient, serializeScene } from "./serialize-scene";

function sceneWithAThread(): { scene: Scene; threadId: string; boxId: string } {
  const scene = new Scene();
  const box = scene.addElement(createRectangleElement({ x: 100, y: 100, width: 100, height: 50 }));
  const thread = scene.addCommentThread(createCommentThread({ anchor: anchorForElementPoint(box, { x: 125, y: 140 }), authorId: "a", authorName: "Ann", now: 1000 }))!;
  scene.addCommentMessage(createCommentMessage({ threadId: thread.id, body: "does this align?", authorId: "a", authorName: "Ann", now: 1000 }));
  scene.addCommentMessage(createCommentMessage({ threadId: thread.id, body: "fixed", authorId: "b", authorName: "Bo", now: 2000 }));
  return { scene, threadId: thread.id, boxId: box.id };
}

const roundTrip = (scene: Scene): Scene => {
  const raw = JSON.parse(JSON.stringify(serializeScene(scene))) as unknown;
  const result = deserializeScene(raw);
  if (!result.ok) throw new Error(result.error);
  return result.scene;
};

describe("comments persistence", () => {
  it("a scene with no comments serializes with NO comment fields — byte-identical to pre-comments output", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 1, y: 1, width: 10, height: 10 }));
    const document = serializeScene(scene);
    expect(document.comments).toBeUndefined();
    expect(document.commentMessages).toBeUndefined();
    expect(JSON.stringify(document)).not.toContain("comment");
  });

  it("round-trips threads, messages, anchors, and authorship", () => {
    const { scene, threadId, boxId } = sceneWithAThread();
    const restored = roundTrip(scene);

    const threads = restored.getCommentThreads();
    expect(threads).toHaveLength(1);
    expect(threads[0]!.id).toBe(threadId);
    expect(threads[0]!.authorName).toBe("Ann");
    expect(threads[0]!.anchor).toEqual(scene.getCommentThread(threadId)!.anchor);
    if (threads[0]!.anchor.kind !== "element") throw new Error("expected an element anchor");
    expect(threads[0]!.anchor.elementId).toBe(boxId);

    expect(restored.getCommentMessages(threadId).map((message) => message.body)).toEqual(["does this align?", "fixed"]);
  });

  it("preserves the LWW envelope exactly, so a reload cannot lose a merge race", () => {
    const { scene, threadId } = sceneWithAThread();
    const before = scene.getCommentThread(threadId)!;
    const after = roundTrip(scene).getCommentThread(threadId)!;
    expect(after.version).toBe(before.version);
    expect(after.versionNonce).toBe(before.versionNonce);
    expect(after.updated).toBe(before.updated);
  });

  it("keeps a deleted thread's tombstone so the deletion survives a reload", () => {
    const { scene, threadId } = sceneWithAThread();
    scene.deleteCommentThread(threadId);
    const restored = roundTrip(scene);
    expect(restored.getCommentThreads()).toHaveLength(0);
    expect(restored.getAllCommentThreads()).toHaveLength(1);
    expect(restored.getAllCommentThreads()[0]!.isDeleted).toBe(true);
  });

  it("keeps a resolved thread, which the canvas hides but the panel still lists", () => {
    const { scene, threadId } = sceneWithAThread();
    scene.setCommentThreadResolved(threadId, true);
    expect(roundTrip(scene).getCommentThreads()[0]!.resolved).toBe(true);
  });

  it("a comment on a since-deleted shape survives as a point-resolved thread", () => {
    const { scene, threadId, boxId } = sceneWithAThread();
    scene.deleteElement(boxId);
    const restored = roundTrip(scene);
    expect(restored.getCommentThreads()).toHaveLength(1);
    // The anchor is NOT rewritten by the deletion — it still names the element, and resolution falls back at read time.
    const anchor = restored.getCommentThread(threadId)!.anchor;
    expect(anchor.kind).toBe("element");
  });
});

describe("comments validation", () => {
  const documentWith = (comments: unknown, commentMessages: unknown): unknown => ({
    type: "devivadraw/scene",
    schemaVersion: 1,
    elements: [],
    files: {},
    ...(comments === undefined ? {} : { comments }),
    ...(commentMessages === undefined ? {} : { commentMessages }),
  });

  it("rejects a malformed thread on the strict path rather than loading a half-valid conversation", () => {
    const result = deserializeScene(documentWith([{ id: "t1", anchor: { kind: "nope" } }], undefined));
    expect(result.ok).toBe(false);
  });

  it("drops a malformed thread on the lenient path and loads the rest of the board", () => {
    const result = deserializeSceneLenient(documentWith([{ id: "broken" }], undefined));
    if (!result.ok) throw new Error(result.error);
    expect(result.droppedErrors.length).toBeGreaterThan(0);
    expect(result.scene.getCommentThreads()).toHaveLength(0);
  });

  it("rejects an unknown anchor kind instead of guessing a pin position", () => {
    const result = deserializeSceneLenient(
      documentWith([{ id: "t1", anchor: { kind: "somewhere" }, resolved: false, authorId: "a", authorName: "A", created: 1, version: 1, versionNonce: 1, updated: 1, isDeleted: false }], undefined),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.scene.getAllCommentThreads()).toHaveLength(0);
  });

  it("caps a hostile thread list rather than loading it whole", () => {
    const threads = Array.from({ length: MAX_COMMENT_THREADS + 10 }, (_, index) => ({
      id: `t${index}`,
      anchor: { kind: "page" },
      resolved: false,
      authorId: "a",
      authorName: "A",
      created: 1,
      version: 1,
      versionNonce: index,
      updated: 1,
      isDeleted: false,
    }));
    const result = deserializeSceneLenient(documentWith(threads, undefined));
    if (!result.ok) throw new Error(result.error);
    expect(result.scene.getAllCommentThreads()).toHaveLength(MAX_COMMENT_THREADS);
  });

  it("caps messages per thread", () => {
    const messages = Array.from({ length: MAX_COMMENT_MESSAGES_PER_THREAD + 10 }, (_, index) => ({
      id: `m${index}`,
      threadId: "t1",
      body: "hi",
      authorId: "a",
      authorName: "A",
      created: index,
      version: 1,
      versionNonce: index,
      updated: 1,
      isDeleted: false,
    }));
    const result = deserializeSceneLenient(documentWith(undefined, messages));
    if (!result.ok) throw new Error(result.error);
    expect(result.scene.getAllCommentMessages()).toHaveLength(MAX_COMMENT_MESSAGES_PER_THREAD);
  });

  it("truncates an over-long body from a hand-edited document", () => {
    const result = deserializeSceneLenient(
      documentWith(undefined, [{ id: "m1", threadId: "t1", body: "x".repeat(99_999), authorId: "a", authorName: "A", created: 1, version: 1, versionNonce: 1, updated: 1, isDeleted: false }]),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.scene.getCommentMessages("t1")[0]!.body.length).toBeLessThanOrEqual(4000);
  });
});

describe("comments through the multi-page document (share links and autosave)", () => {
  it("round-trips per page, because each page nests a full scene document", () => {
    const { scene, threadId } = sceneWithAThread();
    const second = new Scene();
    const raw = JSON.parse(
      JSON.stringify(
        serializeMultiPageDocument([
          { id: "p1", name: "Page 1", scene },
          { id: "p2", name: "Page 2", scene: second },
        ]),
      ),
    ) as unknown;

    const result = deserializeMultiPageDocument(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.pages[0]!.scene.getCommentMessages(threadId)).toHaveLength(2);
    expect(result.pages[1]!.scene.hasComments()).toBe(false);
  });

  it("adds no comment keys to a document whose pages have none", () => {
    const raw = JSON.stringify(serializeMultiPageDocument([{ id: "p1", name: "Page 1", scene: new Scene() }]));
    expect(raw).not.toContain("comment");
  });
});
