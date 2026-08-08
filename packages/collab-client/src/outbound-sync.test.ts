import { describe, expect, it, vi } from "vitest";
import { createRectangleElement, Scene } from "@deviva-draw/engine";
import { decryptEnvelope, encryptEnvelope, generateRoomKey, importRoomKey } from "./message-codec";
import { flushElementDeltas, sendFullSnapshot, sendPresenceUpdate } from "./outbound-sync";

async function freshRoomKey(): Promise<CryptoKey> {
  return importRoomKey(await generateRoomKey());
}

describe("flushElementDeltas", () => {
  it("sends every element whose version isn't yet recorded in syncedVersions", async () => {
    const scene = new Scene();
    const element = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    const roomKey = await freshRoomKey();
    const send = vi.fn<(data: string) => boolean>(() => true);
    const syncedVersions = new Map<string, number>();

    await flushElementDeltas({ scene, roomKey, send }, syncedVersions);

    expect(send).toHaveBeenCalledOnce();
    const envelope = JSON.parse(send.mock.calls[0]![0] as string);
    const decrypted = await decryptEnvelope(roomKey, envelope);
    expect(decrypted).toEqual({ ok: true, payload: { element } });
    expect(syncedVersions.get(element.id)).toBe(element.version);
  });

  it("does not resend an element whose version already matches syncedVersions", async () => {
    const scene = new Scene();
    const element = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    const roomKey = await freshRoomKey();
    const send = vi.fn<(data: string) => boolean>(() => true);
    const syncedVersions = new Map([[element.id, element.version]]);

    await flushElementDeltas({ scene, roomKey, send }, syncedVersions);

    expect(send).not.toHaveBeenCalled();
  });

  it("regression: skips sending a stale frame (and never marks it synced) when the element changes locally during the encrypt await window", async () => {
    const scene = new Scene();
    const element = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    const roomKey = await freshRoomKey();
    const send = vi.fn<(data: string) => boolean>(() => true);
    const syncedVersions = new Map<string, number>();

    let releaseEncrypt: (() => void) | null = null;
    const controlledEncrypt = vi.fn(async (key: CryptoKey, type: string, payload: unknown) => {
      // Suspends here until the test releases it — gives the test a deterministic window to mutate the
      // scene while `flushElementDeltas` is mid-`await`, without racing real timers/microtasks.
      await new Promise<void>((resolve) => {
        releaseEncrypt = resolve;
      });
      return encryptEnvelope(key, type, payload);
    });

    const flushPromise = flushElementDeltas({ scene, roomKey, send, encryptEnvelope: controlledEncrypt }, syncedVersions);
    await vi.waitFor(() => expect(releaseEncrypt).not.toBeNull());

    // Concurrent local edit lands on the same element while the encrypt of its *old* version is still in flight.
    const updated = scene.updateElement(element.id, { x: 999 })!;
    releaseEncrypt!();
    await flushPromise;

    expect(send).not.toHaveBeenCalled(); // the stale (pre-edit) frame must never go out
    expect(syncedVersions.has(element.id)).toBe(false); // not marked synced at the now-superseded version
    expect(updated.version).toBeGreaterThan(element.version);
  });

  it("regression: a remote-merge apply racing the same encrypt window is likewise skipped, not resent stale", async () => {
    const scene = new Scene();
    const element = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    const roomKey = await freshRoomKey();
    const send = vi.fn<(data: string) => boolean>(() => true);
    const syncedVersions = new Map<string, number>();

    let releaseEncrypt: (() => void) | null = null;
    const controlledEncrypt = vi.fn(async (key: CryptoKey, type: string, payload: unknown) => {
      await new Promise<void>((resolve) => {
        releaseEncrypt = resolve;
      });
      return encryptEnvelope(key, type, payload);
    });

    const flushPromise = flushElementDeltas({ scene, roomKey, send, encryptEnvelope: controlledEncrypt }, syncedVersions);
    await vi.waitFor(() => expect(releaseEncrypt).not.toBeNull());

    // Simulates a remote peer's winning delta landing (via applyRemoteElement) during the encrypt window.
    const remoteWinner = { ...element, x: 500, version: element.version + 1, versionNonce: element.versionNonce + 1 };
    scene.applyRemoteElement(remoteWinner);
    releaseEncrypt!();
    await flushPromise;

    expect(send).not.toHaveBeenCalled();
    expect(syncedVersions.has(element.id)).toBe(false);
  });

  it("sends multiple changed elements independently, each with its own encrypt call", async () => {
    const scene = new Scene();
    const a = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    const b = scene.addElement(createRectangleElement({ x: 5, y: 5, width: 1, height: 1 }));
    const roomKey = await freshRoomKey();
    const send = vi.fn<(data: string) => boolean>(() => true);

    await flushElementDeltas({ scene, roomKey, send }, new Map());

    expect(send).toHaveBeenCalledTimes(2);
    void a;
    void b;
  });
});

describe("sendFullSnapshot", () => {
  it("sends every current element (including soft-deleted) as one snapshot message", async () => {
    const scene = new Scene();
    const live = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    const deleted = scene.addElement(createRectangleElement({ x: 5, y: 5, width: 1, height: 1 }));
    scene.deleteElement(deleted.id);
    const roomKey = await freshRoomKey();
    const send = vi.fn<(data: string) => boolean>(() => true);

    await sendFullSnapshot({ scene, roomKey, send });

    expect(send).toHaveBeenCalledOnce();
    const envelope = JSON.parse(send.mock.calls[0]![0] as string);
    const decrypted = await decryptEnvelope(roomKey, envelope);
    expect(decrypted.ok).toBe(true);
    const elements = (decrypted as { payload: { elements: Array<{ id: string }> } }).payload.elements;
    expect(elements.map((el) => el.id).sort()).toEqual([deleted.id, live.id].sort());
  });
});

describe("sendPresenceUpdate", () => {
  it("sends an uncompressed presence envelope", async () => {
    const roomKey = await freshRoomKey();
    const send = vi.fn<(data: string) => boolean>(() => true);
    const payload = { name: "Alice", color: "#fff", point: { x: 1, y: 2 }, selectedElementIds: [], viewport: null };

    await sendPresenceUpdate({ roomKey, send }, payload);

    expect(send).toHaveBeenCalledOnce();
    const envelope = JSON.parse(send.mock.calls[0]![0] as string);
    const decrypted = await decryptEnvelope(roomKey, envelope, { compress: false });
    expect(decrypted).toEqual({ ok: true, payload });
  });
});
