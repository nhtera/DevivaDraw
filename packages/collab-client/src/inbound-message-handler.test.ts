import { describe, expect, it, vi } from "vitest";
import { createRectangleElement, Scene } from "@deviva-draw/engine";
import { encryptEnvelope, generateRoomKey, importRoomKey } from "./message-codec";
import { handleInboundMessage } from "./inbound-message-handler";
import { PresenceStore } from "./presence-state";

async function makeDeps() {
  const scene = new Scene();
  const presence = new PresenceStore();
  const roomKey = await importRoomKey(await generateRoomKey());
  const markSynced = vi.fn();
  const onPeerLeft = vi.fn();
  const onPeerJoined = vi.fn();
  const onSnapshotRequested = vi.fn();
  return { scene, presence, roomKey, markSynced, onPeerLeft, onPeerJoined, onSnapshotRequested };
}

describe("handleInboundMessage — element-delta", () => {
  it("applies a valid encrypted element delta and marks it synced", async () => {
    const deps = await makeDeps();
    const source = new Scene();
    const element = source.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    const envelope = await encryptEnvelope(deps.roomKey, "element-delta", { element });

    await handleInboundMessage(JSON.stringify(envelope), deps);

    expect(deps.scene.getElement(element.id)).toEqual(element);
    expect(deps.markSynced).toHaveBeenCalledWith(element.id, element.version, undefined);
  });

  it("does not mark synced when the remote element loses the LWW comparison", async () => {
    const deps = await makeDeps();
    const local = deps.scene.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    const stale = { ...local, version: 0, x: 999 };
    const envelope = await encryptEnvelope(deps.roomKey, "element-delta", { element: stale });

    await handleInboundMessage(JSON.stringify(envelope), deps);

    expect(deps.scene.getElement(local.id)).toEqual(local);
    expect(deps.markSynced).not.toHaveBeenCalled();
  });
});

describe("handleInboundMessage — snapshot", () => {
  it("applies every element in a valid snapshot payload", async () => {
    const deps = await makeDeps();
    const source = new Scene();
    const a = source.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    const b = source.addElement(createRectangleElement({ x: 5, y: 5, width: 1, height: 1 }));
    const envelope = await encryptEnvelope(deps.roomKey, "snapshot", { elements: [a, b] });

    await handleInboundMessage(JSON.stringify(envelope), deps);

    expect(deps.scene.getElement(a.id)).toEqual(a);
    expect(deps.scene.getElement(b.id)).toEqual(b);
    expect(deps.markSynced).toHaveBeenCalledTimes(2);
  });

  it("ignores a snapshot payload whose elements field isn't an array", async () => {
    const deps = await makeDeps();
    const envelope = await encryptEnvelope(deps.roomKey, "snapshot", { elements: "not-an-array" });
    await expect(handleInboundMessage(JSON.stringify(envelope), deps)).resolves.toBeUndefined();
    expect(deps.markSynced).not.toHaveBeenCalled();
  });
});

describe("handleInboundMessage — presence", () => {
  it("applies a valid presence update tagged with the sender's peerId", async () => {
    const deps = await makeDeps();
    const payload = { name: "Bob", color: "#00ff00", point: { x: 1, y: 1 }, selectedElementIds: [], viewport: null };
    const envelope = { ...(await encryptEnvelope(deps.roomKey, "presence", payload, { compress: false })), peerId: "peer-42" };

    await handleInboundMessage(JSON.stringify(envelope), deps);

    expect(deps.presence.get("peer-42")).toMatchObject({ name: "Bob" });
  });

  it("ignores a presence envelope missing a peerId", async () => {
    const deps = await makeDeps();
    const payload = { name: "Bob", color: "#00ff00", point: null, selectedElementIds: [], viewport: null };
    const envelope = await encryptEnvelope(deps.roomKey, "presence", payload, { compress: false });

    await handleInboundMessage(JSON.stringify(envelope), deps);

    expect(deps.presence.list()).toHaveLength(0);
  });
});

describe("handleInboundMessage — peer lifecycle", () => {
  it("routes peer-left to onPeerLeft", async () => {
    const deps = await makeDeps();
    await handleInboundMessage(JSON.stringify({ type: "peer-left", peerId: "peer-1" }), deps);
    expect(deps.onPeerLeft).toHaveBeenCalledWith("peer-1");
  });

  it("routes peer-joined to onPeerJoined, so existing peers republish for the newcomer", async () => {
    const deps = await makeDeps();
    await handleInboundMessage(JSON.stringify({ type: "peer-joined", peerId: "peer-1" }), deps);
    expect(deps.onPeerJoined).toHaveBeenCalledOnce();
    // Nothing is applied to the scene or presence store from an announcement — it carries no state.
    expect(deps.presence.list()).toHaveLength(0);
  });

  it("routes a relay-forwarded snapshot-request to onSnapshotRequested", async () => {
    const deps = await makeDeps();
    await handleInboundMessage(JSON.stringify({ type: "snapshot-request" }), deps);
    expect(deps.onSnapshotRequested).toHaveBeenCalledOnce();
  });
});

describe("handleInboundMessage — hostile/malformed input never throws", () => {
  const cases: Array<[string, string]> = [
    ["not json at all", "{{{"],
    ["a JSON array instead of an object", "[1,2,3]"],
    ["a JSON primitive", '"hello"'],
    ["an object with no type", "{}"],
    ["an object with a non-string type", '{"type":42}'],
    ["an unknown type", '{"type":"delete-everything"}'],
    ["an element-delta with garbage ciphertext", '{"type":"element-delta","iv":"not-real","ciphertext":"also-not-real"}'],
    ["a presence message with no peerId", '{"type":"presence","iv":"x","ciphertext":"y"}'],
  ];

  it.each(cases)("%s", async (_label, raw) => {
    const deps = await makeDeps();
    await expect(handleInboundMessage(raw, deps)).resolves.toBeUndefined();
    expect(deps.scene.getElements()).toHaveLength(0);
    expect(deps.presence.list()).toHaveLength(0);
  });

  it("rejects a wrong-key element-delta without crashing or applying anything", async () => {
    const deps = await makeDeps();
    const wrongKey = await importRoomKey(await generateRoomKey());
    const source = new Scene();
    const element = source.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    const envelope = await encryptEnvelope(wrongKey, "element-delta", { element });

    await handleInboundMessage(JSON.stringify(envelope), deps);

    expect(deps.scene.getElements()).toHaveLength(0);
  });
});
