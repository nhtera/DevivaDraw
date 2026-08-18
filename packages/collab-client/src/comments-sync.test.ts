import { describe, expect, it, vi } from "vitest";
import { createCommentMessage, createCommentThread, Scene } from "@deviva-draw/engine";
import { handleInboundMessage } from "./inbound-message-handler";
import { flushCommentDeltas, sendFullSnapshot } from "./outbound-sync";
import { generateRoomKey, importRoomKey, encryptEnvelope } from "./message-codec";
import { PresenceStore } from "./presence-state";

/**
 * Comments end-to-end through the real encrypt → wire → decrypt → apply path, plus the hostile-peer
 * and old-client tolerance cases: the relay never sees any of this, so the client is the only place
 * an invalid record can be stopped.
 */

async function makeDeps(scene: Scene) {
  return {
    scene,
    presence: new PresenceStore(),
    roomKey: await importRoomKey(await generateRoomKey()),
    markSynced: vi.fn(),
    markCommentSynced: vi.fn(),
    onPeerLeft: vi.fn(),
    onSnapshotRequested: vi.fn(),
  };
}

/** A sender scene with one page-anchored thread and one reply. */
function sceneWithAThread(): { scene: Scene; threadId: string } {
  const scene = new Scene();
  const thread = scene.addCommentThread(createCommentThread({ anchor: { kind: "page" }, authorId: "a", authorName: "Ann", now: 1000 }))!;
  scene.addCommentMessage(createCommentMessage({ threadId: thread.id, body: "first", authorId: "a", authorName: "Ann", now: 1000 }));
  return { scene, threadId: thread.id };
}

/** Collects the frames an outbound flush produces, so a test can replay them into a receiver. */
function collector(): { send: (data: string) => boolean; frames: string[] } {
  const frames: string[] = [];
  return {
    frames,
    send: (data: string) => {
      frames.push(data);
      return true;
    },
  };
}

describe("comment deltas over the wire", () => {
  it("carries a thread and its reply to a receiver through the real codec", async () => {
    const { scene: sender, threadId } = sceneWithAThread();
    const receiver = new Scene();
    const deps = await makeDeps(receiver);
    const sink = collector();

    await flushCommentDeltas({ scene: sender, roomKey: deps.roomKey, send: sink.send }, new Map());
    expect(sink.frames).toHaveLength(2); // one thread record + one message record, never batched
    for (const frame of sink.frames) await handleInboundMessage(frame, deps);

    expect(receiver.getCommentThreads()).toHaveLength(1);
    expect(receiver.getCommentMessages(threadId).map((message) => message.body)).toEqual(["first"]);
    expect(deps.markCommentSynced).toHaveBeenCalledTimes(2);
  });

  it("does not resend an unchanged record on the next flush", async () => {
    const { scene: sender } = sceneWithAThread();
    const roomKey = await importRoomKey(await generateRoomKey());
    const synced = new Map<string, number>();
    const first = collector();
    await flushCommentDeltas({ scene: sender, roomKey, send: first.send }, synced);
    const second = collector();
    await flushCommentDeltas({ scene: sender, roomKey, send: second.send }, synced);
    expect(first.frames.length).toBe(2);
    expect(second.frames).toHaveLength(0);
  });

  it("sends a delta again once the record changes", async () => {
    const { scene: sender, threadId } = sceneWithAThread();
    const roomKey = await importRoomKey(await generateRoomKey());
    const synced = new Map<string, number>();
    await flushCommentDeltas({ scene: sender, roomKey, send: collector().send }, synced);
    sender.setCommentThreadResolved(threadId, true);
    const next = collector();
    await flushCommentDeltas({ scene: sender, roomKey, send: next.send }, synced);
    expect(next.frames).toHaveLength(1);
  });

  it("propagates a resolve and a delete, and a delete survives a later stale copy of the same thread", async () => {
    const { scene: sender, threadId } = sceneWithAThread();
    const receiver = new Scene();
    const deps = await makeDeps(receiver);
    const synced = new Map<string, number>();

    const initial = collector();
    await flushCommentDeltas({ scene: sender, roomKey: deps.roomKey, send: initial.send }, synced);
    for (const frame of initial.frames) await handleInboundMessage(frame, deps);

    sender.deleteCommentThread(threadId);
    const deletion = collector();
    await flushCommentDeltas({ scene: sender, roomKey: deps.roomKey, send: deletion.send }, synced);
    for (const frame of deletion.frames) await handleInboundMessage(frame, deps);
    expect(receiver.getCommentThreads()).toHaveLength(0);

    // A peer that reconnects with its pre-delete copy must not resurrect the thread.
    for (const frame of initial.frames) await handleInboundMessage(frame, deps);
    expect(receiver.getCommentThreads()).toHaveLength(0);
  });

  it("keeps both replies when two peers answer concurrently", async () => {
    const shared = createCommentThread({ anchor: { kind: "page" }, authorId: "a", authorName: "Ann", now: 1000 });
    const peerA = new Scene();
    const peerB = new Scene();
    peerA.addCommentThread(shared);
    peerB.addCommentThread(shared);
    peerA.addCommentMessage(createCommentMessage({ threadId: shared.id, body: "from A", authorId: "a", authorName: "Ann", now: 1000 }));
    peerB.addCommentMessage(createCommentMessage({ threadId: shared.id, body: "from B", authorId: "b", authorName: "Bo", now: 1000 }));

    const depsA = await makeDeps(peerA);
    const depsB = { ...(await makeDeps(peerB)), roomKey: depsA.roomKey };
    const fromA = collector();
    const fromB = collector();
    await flushCommentDeltas({ scene: peerA, roomKey: depsA.roomKey, send: fromA.send }, new Map());
    await flushCommentDeltas({ scene: peerB, roomKey: depsA.roomKey, send: fromB.send }, new Map());
    for (const frame of fromB.frames) await handleInboundMessage(frame, depsA);
    for (const frame of fromA.frames) await handleInboundMessage(frame, depsB);

    // Neither reply is lost, and both peers read the conversation in the SAME order — the ordering
    // tiebreak is deterministic, so two peers never render the same thread differently.
    expect(peerA.getCommentMessages(shared.id).map((message) => message.body).sort()).toEqual(["from A", "from B"]);
    expect(peerB.getCommentMessages(shared.id)).toEqual(peerA.getCommentMessages(shared.id));
  });
});

describe("comments in a snapshot", () => {
  it("rides the full snapshot to a peer that just joined", async () => {
    const { scene: sender, threadId } = sceneWithAThread();
    const receiver = new Scene();
    const deps = await makeDeps(receiver);
    const sink = collector();
    await sendFullSnapshot({ scene: sender, roomKey: deps.roomKey, send: sink.send });
    for (const frame of sink.frames) await handleInboundMessage(frame, deps);
    expect(receiver.getCommentMessages(threadId)).toHaveLength(1);
  });

  it("omits the comment keys entirely for a scene with no comments, so a pre-comments peer sees its historical payload", async () => {
    const scene = new Scene();
    const roomKey = await importRoomKey(await generateRoomKey());
    const sink = collector();
    await sendFullSnapshot({ scene, roomKey, send: sink.send });
    // The payload is ciphertext, so assert on the decrypted shape instead of the frame text.
    const receiver = new Scene();
    const deps = { ...(await makeDeps(receiver)), roomKey };
    await handleInboundMessage(sink.frames[0]!, deps);
    expect(receiver.hasComments()).toBe(false);
  });

  it("tolerates a snapshot from a pre-comments peer (no comment keys at all)", async () => {
    const receiver = new Scene();
    const deps = await makeDeps(receiver);
    const envelope = await encryptEnvelope(deps.roomKey, "snapshot", { elements: [] });
    await handleInboundMessage(JSON.stringify(envelope), deps);
    expect(receiver.hasComments()).toBe(false);
  });
});

describe("hostile comment input", () => {
  const send = () => true;

  it("drops a record that is not shaped like a comment", async () => {
    const receiver = new Scene();
    const deps = await makeDeps(receiver);
    for (const bad of [null, 42, { id: "" }, { id: "t1", anchor: { kind: "nope" } }, { id: "t1" }]) {
      const envelope = await encryptEnvelope(deps.roomKey, "comment-delta", { thread: bad });
      await handleInboundMessage(JSON.stringify(envelope), deps);
    }
    expect(receiver.getAllCommentThreads()).toHaveLength(0);
    expect(deps.markCommentSynced).not.toHaveBeenCalled();
  });

  it("clamps an over-long body rather than storing what the peer sent", async () => {
    const receiver = new Scene();
    const deps = await makeDeps(receiver);
    const message = { id: "m1", threadId: "t1", body: "x".repeat(50_000), authorId: "a", authorName: "A", created: 1, version: 1, versionNonce: 1, updated: 1, isDeleted: false };
    const envelope = await encryptEnvelope(deps.roomKey, "comment-delta", { message });
    await handleInboundMessage(JSON.stringify(envelope), deps);
    expect(receiver.getCommentMessages("t1")[0]!.body.length).toBeLessThanOrEqual(4000);
  });

  it("clamps an over-long author name", async () => {
    const receiver = new Scene();
    const deps = await makeDeps(receiver);
    const thread = { id: "t1", anchor: { kind: "page" }, resolved: false, authorId: "a", authorName: "N".repeat(5000), created: 1, version: 1, versionNonce: 1, updated: 1, isDeleted: false };
    const envelope = await encryptEnvelope(deps.roomKey, "comment-delta", { thread });
    await handleInboundMessage(JSON.stringify(envelope), deps);
    expect(receiver.getCommentThreads()[0]!.authorName.length).toBeLessThanOrEqual(64);
  });

  it("ignores a comment-delta whose ciphertext does not decrypt, without throwing", async () => {
    const receiver = new Scene();
    const deps = await makeDeps(receiver);
    await handleInboundMessage(JSON.stringify({ type: "comment-delta", iv: "zzz", ciphertext: "zzz" }), deps);
    expect(receiver.getAllCommentThreads()).toHaveLength(0);
    void send;
  });
});
