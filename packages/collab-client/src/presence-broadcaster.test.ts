import { describe, expect, it, vi } from "vitest";
import { decryptEnvelope, generateRoomKey, importRoomKey } from "./message-codec";
import { PresenceBroadcaster } from "./presence-broadcaster";
import type { PresenceSendDeps } from "./presence-broadcaster";

async function freshSendDeps(send: (data: string) => boolean): Promise<PresenceSendDeps> {
  const roomKey = await importRoomKey(await generateRoomKey());
  return { roomKey, send };
}

// Real timers throughout (no `vi.useFakeTimers()`): every send here goes through real `crypto.subtle`
// (async but timer-independent), and every case either hits `throttle()`'s synchronous leading edge or
// bypasses the throttle entirely via `republish()` — nothing here depends on a delayed trailing-edge
// timer firing, unlike `presence-state.test.ts`'s dedicated `throttle()` timing tests.
describe("PresenceBroadcaster", () => {
  it("updateCursor sends a presence payload with name/color/point on the leading edge", async () => {
    const send = vi.fn<(data: string) => boolean>(() => true);
    const sendDeps = await freshSendDeps(send);
    const broadcaster = new PresenceBroadcaster({ userName: "Alice", userColor: "#ff0000", throttleMs: 100, getSendDeps: () => sendDeps });

    broadcaster.updateCursor({ x: 1, y: 2 });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    const envelope = JSON.parse(send.mock.calls[0]![0] as string);
    const decrypted = await decryptEnvelope(sendDeps.roomKey, envelope, { compress: false });
    expect(decrypted).toEqual({ ok: true, payload: { name: "Alice", color: "#ff0000", point: { x: 1, y: 2 }, selectedElementIds: [], viewport: null } });
  });

  it("is a no-op (never throws) when getSendDeps returns null — no active connection to send over", async () => {
    const broadcaster = new PresenceBroadcaster({ userName: "Alice", userColor: "#ff0000", throttleMs: 100, getSendDeps: () => null });
    expect(() => broadcaster.updateCursor({ x: 1, y: 1 })).not.toThrow();
    expect(() => broadcaster.republish()).not.toThrow();
    await Promise.resolve(); // let the internal (immediately-resolving) async send settle
  });

  it("setLocalSelection/setLocalViewport ride along with the next cursor send", async () => {
    const send = vi.fn<(data: string) => boolean>(() => true);
    const sendDeps = await freshSendDeps(send);
    const broadcaster = new PresenceBroadcaster({ userName: "Bob", userColor: "#00ff00", throttleMs: 100, getSendDeps: () => sendDeps });

    broadcaster.setLocalSelection(["el-1", "el-2"]);
    broadcaster.setLocalViewport({ x: 10, y: 20, zoom: 1.5 });
    broadcaster.updateCursor({ x: 5, y: 5 });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    const envelope = JSON.parse(send.mock.calls[0]![0] as string);
    const decrypted = await decryptEnvelope(sendDeps.roomKey, envelope, { compress: false });
    expect(decrypted).toEqual({
      ok: true,
      payload: { name: "Bob", color: "#00ff00", point: { x: 5, y: 5 }, selectedElementIds: ["el-1", "el-2"], viewport: { x: 10, y: 20, zoom: 1.5 } },
    });
  });

  it("republish resends the last known point immediately, bypassing the throttle window", async () => {
    const send = vi.fn<(data: string) => boolean>(() => true);
    const sendDeps = await freshSendDeps(send);
    const broadcaster = new PresenceBroadcaster({ userName: "Alice", userColor: "#fff", throttleMs: 10_000, getSendDeps: () => sendDeps });

    broadcaster.updateCursor({ x: 7, y: 8 });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    // Still well inside the (huge) throttle window — a second updateCursor would be suppressed, but
    // republish() must not be throttled at all.
    broadcaster.republish();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));

    const envelope = JSON.parse(send.mock.calls[1]![0] as string);
    const decrypted = await decryptEnvelope(sendDeps.roomKey, envelope, { compress: false });
    expect(decrypted).toEqual({ ok: true, payload: expect.objectContaining({ point: { x: 7, y: 8 } }) });
  });

  it("republish sends a null point when the cursor has never moved yet", async () => {
    const send = vi.fn<(data: string) => boolean>(() => true);
    const sendDeps = await freshSendDeps(send);
    const broadcaster = new PresenceBroadcaster({ userName: "Alice", userColor: "#fff", throttleMs: 100, getSendDeps: () => sendDeps });

    broadcaster.republish();
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    const envelope = JSON.parse(send.mock.calls[0]![0] as string);
    const decrypted = await decryptEnvelope(sendDeps.roomKey, envelope, { compress: false });
    expect(decrypted).toEqual({ ok: true, payload: expect.objectContaining({ point: null }) });
  });

  it("reset() clears tracked point/selection/viewport so the next republish sends a blank slate", async () => {
    const send = vi.fn<(data: string) => boolean>(() => true);
    const sendDeps = await freshSendDeps(send);
    const broadcaster = new PresenceBroadcaster({ userName: "Alice", userColor: "#fff", throttleMs: 100, getSendDeps: () => sendDeps });

    broadcaster.setLocalSelection(["el-1"]);
    broadcaster.updateCursor({ x: 1, y: 1 });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    broadcaster.reset();
    broadcaster.republish();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));

    const envelope = JSON.parse(send.mock.calls[1]![0] as string);
    const decrypted = await decryptEnvelope(sendDeps.roomKey, envelope, { compress: false });
    expect(decrypted).toEqual({ ok: true, payload: { name: "Alice", color: "#fff", point: null, selectedElementIds: [], viewport: null } });
  });

  it("re-resolves getSendDeps on every send, not just once at construction (supports a rotating/reconnecting connection)", async () => {
    const sendA = vi.fn<(data: string) => boolean>(() => true);
    const sendB = vi.fn<(data: string) => boolean>(() => true);
    let current = await freshSendDeps(sendA);
    const broadcaster = new PresenceBroadcaster({ userName: "Alice", userColor: "#fff", throttleMs: 10_000, getSendDeps: () => current });

    broadcaster.updateCursor({ x: 1, y: 1 });
    await vi.waitFor(() => expect(sendA).toHaveBeenCalledOnce());

    current = await freshSendDeps(sendB);
    broadcaster.republish();
    await vi.waitFor(() => expect(sendB).toHaveBeenCalledOnce());
    expect(sendA).toHaveBeenCalledOnce();
  });
});
