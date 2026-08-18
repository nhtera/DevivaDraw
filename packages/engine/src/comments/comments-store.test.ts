import { describe, expect, it } from "vitest";
import { SceneCommentsStore } from "./comments-store";
import type { CommentMessage, CommentThread } from "./comment-types";
import { createCommentMessage, createCommentThread, MAX_COMMENT_BODY_LENGTH, MAX_COMMENT_THREADS } from "./comment-types";

const anchor = { kind: "point" as const, x: 10, y: 20 };

function newThread(overrides: Partial<CommentThread> = {}): CommentThread {
  return { ...createCommentThread({ anchor, authorId: "a", authorName: "Ann", now: 1000 }), ...overrides };
}

function newMessage(threadId: string, overrides: Partial<CommentMessage> = {}): CommentMessage {
  return { ...createCommentMessage({ threadId, body: "hello", authorId: "a", authorName: "Ann", now: 1000 }), ...overrides };
}

/** A remote record as it arrives off the wire: already versioned by its sender, never re-touched locally. */
function remote<T extends CommentThread | CommentMessage>(record: T, version: number, versionNonce: number, changes: Partial<T> = {}): T {
  return { ...record, ...changes, version, versionNonce, updated: 5000 };
}

describe("SceneCommentsStore local mutations", () => {
  it("stamps the first version on insert and exposes the thread", () => {
    const store = new SceneCommentsStore();
    const thread = store.addThread(newThread())!;
    expect(thread.version).toBe(1);
    expect(store.getThreads()).toHaveLength(1);
    expect(store.isEmpty()).toBe(false);
  });

  it("is empty for a fresh store, so serialization can omit comments entirely", () => {
    expect(new SceneCommentsStore().isEmpty()).toBe(true);
  });

  it("refuses a reply into an unknown or deleted thread", () => {
    const store = new SceneCommentsStore();
    const thread = store.addThread(newThread())!;
    expect(store.addMessage(newMessage("nope"))).toBeNull();
    store.deleteThread(thread.id);
    expect(store.addMessage(newMessage(thread.id))).toBeNull();
  });

  it("lets only the author edit or delete their own message", () => {
    const store = new SceneCommentsStore();
    const thread = store.addThread(newThread())!;
    const message = store.addMessage(newMessage(thread.id))!;
    expect(store.editMessage(message.id, "edited", "someone-else")).toBeNull();
    expect(store.deleteMessage(message.id, "someone-else")).toBeNull();
    const edited = store.editMessage(message.id, "edited", "a")!;
    expect(edited.body).toBe("edited");
    expect(edited.version).toBe(2);
    expect(store.deleteMessage(message.id, "a")).not.toBeNull();
    expect(store.getMessages(thread.id)).toHaveLength(0);
  });

  it("hides deleted threads from reads but keeps their tombstone for serialization", () => {
    const store = new SceneCommentsStore();
    const thread = store.addThread(newThread())!;
    store.deleteThread(thread.id);
    expect(store.getThreads()).toHaveLength(0);
    expect(store.getAllThreads()).toHaveLength(1);
    expect(store.getAllThreads()[0]!.isDeleted).toBe(true);
  });

  it("truncates an over-long body instead of dropping the comment", () => {
    const store = new SceneCommentsStore();
    const thread = store.addThread(newThread())!;
    const message = store.addMessage(newMessage(thread.id, { body: "x".repeat(MAX_COMMENT_BODY_LENGTH + 500) }))!;
    expect(message.body).toHaveLength(MAX_COMMENT_BODY_LENGTH);
  });

  it("caps the thread count against a hostile or runaway producer", () => {
    const store = new SceneCommentsStore();
    for (let index = 0; index < MAX_COMMENT_THREADS; index += 1) expect(store.addThread(newThread())).not.toBeNull();
    expect(store.addThread(newThread())).toBeNull();
  });

  it("bumps the O(1) version on every change from any source", () => {
    const store = new SceneCommentsStore();
    const before = store.getVersion();
    const thread = store.addThread(newThread())!;
    expect(store.getVersion()).toBeGreaterThan(before);
    const afterAdd = store.getVersion();
    store.applyRemoteThread(remote(thread, 9, 9));
    expect(store.getVersion()).toBeGreaterThan(afterAdd);
  });

  it("renames the local author across their own records only", () => {
    const store = new SceneCommentsStore();
    const thread = store.addThread(newThread())!;
    store.addMessage(newMessage(thread.id, { created: 1000 }));
    store.addMessage(newMessage(thread.id, { authorId: "b", authorName: "Bo", created: 2000 }));
    const changed = store.renameAuthor("a", "Annie");
    expect(changed.threads).toHaveLength(1);
    expect(changed.messages).toHaveLength(1);
    expect(store.getMessages(thread.id).map((message) => message.authorName)).toEqual(["Annie", "Bo"]);
  });

  it("orders messages by creation time so every peer reads the same conversation", () => {
    const store = new SceneCommentsStore();
    const thread = store.addThread(newThread())!;
    store.applyRemoteMessage(remote(newMessage(thread.id, { body: "second", created: 2000 }), 1, 1));
    store.applyRemoteMessage(remote(newMessage(thread.id, { body: "first", created: 1000 }), 1, 1));
    expect(store.getMessages(thread.id).map((message) => message.body)).toEqual(["first", "second"]);
  });
});

describe("SceneCommentsStore convergence", () => {
  it("adopts a strictly newer remote record and rejects a strictly older one", () => {
    const store = new SceneCommentsStore();
    const thread = store.addThread(newThread())!;
    expect(store.applyRemoteThread(remote(thread, 5, 1, { resolved: true }))).toBe(true);
    expect(store.getThread(thread.id)!.resolved).toBe(true);
    expect(store.applyRemoteThread(remote(thread, 2, 999, { resolved: false }))).toBe(false);
    expect(store.getThread(thread.id)!.resolved).toBe(true);
  });

  it("adopts a remote record byte-for-byte rather than minting a fresh version", () => {
    const store = new SceneCommentsStore();
    const thread = store.addThread(newThread())!;
    store.applyRemoteThread(remote(thread, 7, 42, { resolved: true }));
    const stored = store.getThread(thread.id)!;
    expect(stored.version).toBe(7);
    expect(stored.versionNonce).toBe(42);
  });

  it("treats an already-applied identical record as a no-op", () => {
    const store = new SceneCommentsStore();
    const thread = store.addThread(newThread())!;
    const delta = remote(thread, 4, 4);
    expect(store.applyRemoteThread(delta)).toBe(true);
    expect(store.applyRemoteThread(delta)).toBe(false);
  });

  it("converges on the same state regardless of delta arrival order", () => {
    const base = newThread({ id: "t1" });
    const deltaA = remote(base, 3, 100, { resolved: true });
    const deltaB = remote(base, 3, 200, { resolved: false });

    const first = new SceneCommentsStore();
    first.applyRemoteThread(deltaA);
    first.applyRemoteThread(deltaB);

    const second = new SceneCommentsStore();
    second.applyRemoteThread(deltaB);
    second.applyRemoteThread(deltaA);

    expect(first.getAllThreads()).toEqual(second.getAllThreads());
  });

  it("keeps both replies when two peers answer at the same time", () => {
    const thread = newThread({ id: "t1", version: 1, versionNonce: 1 });
    const fromA = remote(newMessage("t1", { id: "m-a", body: "from A" }), 1, 10);
    const fromB = remote(newMessage("t1", { id: "m-b", body: "from B" }), 1, 20);

    const peerA = new SceneCommentsStore();
    peerA.applyRemoteThread(thread);
    peerA.applyRemoteMessage(fromA);
    peerA.applyRemoteMessage(fromB);

    const peerB = new SceneCommentsStore();
    peerB.applyRemoteThread(thread);
    peerB.applyRemoteMessage(fromB);
    peerB.applyRemoteMessage(fromA);

    expect(peerA.getMessages("t1")).toHaveLength(2);
    expect(peerA.getMessages("t1")).toEqual(peerB.getMessages("t1"));
  });

  it("converges on delete-vs-edit of the same record in either arrival order", () => {
    const base = newThread({ id: "t1" });
    const deletion = remote(base, 6, 100, { isDeleted: true });
    const edit = remote(base, 6, 200, { resolved: true });

    const deleter = new SceneCommentsStore();
    deleter.applyRemoteThread(deletion);
    deleter.applyRemoteThread(edit);

    const editor = new SceneCommentsStore();
    editor.applyRemoteThread(edit);
    editor.applyRemoteThread(deletion);

    expect(deleter.getAllThreads()).toEqual(editor.getAllThreads());
  });

  it("keeps a delete that is strictly newer than a concurrent edit", () => {
    const base = newThread({ id: "t1" });
    const store = new SceneCommentsStore();
    store.applyRemoteThread(remote(base, 6, 200, { resolved: true }));
    store.applyRemoteThread(remote(base, 7, 1, { isDeleted: true }));
    expect(store.getThreads()).toHaveLength(0);
  });

  it("accepts a message whose thread has not arrived yet and shows it once the thread lands", () => {
    const store = new SceneCommentsStore();
    expect(store.applyRemoteMessage(remote(newMessage("t1", { id: "m1" }), 1, 1))).toBe(true);
    expect(store.getMessages("t1")).toHaveLength(1);
    expect(store.getThreads()).toHaveLength(0);
    store.applyRemoteThread(remote(newThread({ id: "t1" }), 1, 1));
    expect(store.getThreads()).toHaveLength(1);
  });
});

describe("SceneCommentsStore replaceAll", () => {
  it("round-trips a document's records and truncates an over-cap list rather than failing", () => {
    const store = new SceneCommentsStore();
    const threads = Array.from({ length: MAX_COMMENT_THREADS + 5 }, (_, index) => newThread({ id: `t${index}`, version: 1, versionNonce: index }));
    store.replaceAll(threads, [{ ...newMessage("t0", { id: "m0" }), version: 1, versionNonce: 1 }]);
    expect(store.getAllThreads()).toHaveLength(MAX_COMMENT_THREADS);
    expect(store.getMessages("t0")).toHaveLength(1);
  });

  it("clears prior state so a reload never mixes two documents", () => {
    const store = new SceneCommentsStore();
    store.addThread(newThread({ id: "old" }));
    store.replaceAll([], []);
    expect(store.isEmpty()).toBe(true);
  });
});
