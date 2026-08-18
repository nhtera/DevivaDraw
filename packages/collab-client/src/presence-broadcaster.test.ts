import { describe, expect, it, vi } from "vitest";
import { decryptEnvelope, generateRoomKey, importRoomKey } from "./message-codec";
import { PresenceBroadcaster } from "./presence-broadcaster";
import type { PresenceSendDeps } from "./presence-broadcaster";
import { MAX_REACTION_EMOJI_LENGTH } from "./presence-state";

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

  it("setLocalSelection rides along with the next cursor send rather than sending on its own", async () => {
    const send = vi.fn<(data: string) => boolean>(() => true);
    const sendDeps = await freshSendDeps(send);
    const broadcaster = new PresenceBroadcaster({ userName: "Bob", userColor: "#00ff00", throttleMs: 100, getSendDeps: () => sendDeps });

    broadcaster.setLocalSelection(["el-1", "el-2"]);
    broadcaster.updateCursor({ x: 5, y: 5 });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    const envelope = JSON.parse(send.mock.calls[0]![0] as string);
    const decrypted = await decryptEnvelope(sendDeps.roomKey, envelope, { compress: false });
    expect(decrypted).toEqual({
      ok: true,
      payload: { name: "Bob", color: "#00ff00", point: { x: 5, y: 5 }, selectedElementIds: ["el-1", "el-2"], viewport: null },
    });
  });

  it("setLocalViewport publishes on its own — a wheel zoom moves no pointer, and a follower must still see it", async () => {
    const send = vi.fn<(data: string) => boolean>(() => true);
    const sendDeps = await freshSendDeps(send);
    const broadcaster = new PresenceBroadcaster({ userName: "Bob", userColor: "#00ff00", throttleMs: 100, getSendDeps: () => sendDeps });

    broadcaster.setLocalViewport({ x: 10, y: 20, zoom: 1.5 });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    const envelope = JSON.parse(send.mock.calls[0]![0] as string);
    const decrypted = await decryptEnvelope(sendDeps.roomKey, envelope, { compress: false });
    expect(decrypted).toEqual({
      ok: true,
      payload: { name: "Bob", color: "#00ff00", point: null, selectedElementIds: [], viewport: { x: 10, y: 20, zoom: 1.5 } },
    });
  });

  it("setLocalViewport ignores an unchanged viewport — a re-render that recomputes the same numbers costs no broadcast", async () => {
    const send = vi.fn<(data: string) => boolean>(() => true);
    const sendDeps = await freshSendDeps(send);
    const broadcaster = new PresenceBroadcaster({ userName: "Bob", userColor: "#00ff00", throttleMs: 100, getSendDeps: () => sendDeps });

    broadcaster.setLocalViewport({ x: 10, y: 20, zoom: 1.5 });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    broadcaster.setLocalViewport({ x: 10, y: 20, zoom: 1.5 });
    await new Promise((resolve) => setTimeout(resolve, 150)); // past the throttle's trailing edge
    expect(send).toHaveBeenCalledOnce();
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

describe("PresenceBroadcaster reactions and raised hand", () => {
  /** Every payload this broadcaster has sent so far, decrypted in send order. */
  async function sentPayloads(send: ReturnType<typeof vi.fn>, deps: PresenceSendDeps): Promise<Record<string, unknown>[]> {
    const payloads: Record<string, unknown>[] = [];
    for (const call of send.mock.calls) {
      const decrypted = await decryptEnvelope(deps.roomKey, JSON.parse(call[0] as string), { compress: false });
      if (decrypted.ok) payloads.push(decrypted.payload as Record<string, unknown>);
    }
    return payloads;
  }

  it("sends a reaction immediately rather than waiting for the next pointer move", async () => {
    const send = vi.fn<(data: string) => boolean>(() => true);
    const sendDeps = await freshSendDeps(send);
    const broadcaster = new PresenceBroadcaster({ userName: "Ann", userColor: "#f00", throttleMs: 10_000, getSendDeps: () => sendDeps });

    broadcaster.sendReaction("🎉");
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect((await sentPayloads(send, sendDeps))[0]!.reaction).toEqual({ emoji: "🎉", at: expect.any(Number) });
  });

  it("clears a reaction after it is sent, so it does not repeat on every later broadcast", async () => {
    const send = vi.fn<(data: string) => boolean>(() => true);
    const sendDeps = await freshSendDeps(send);
    const broadcaster = new PresenceBroadcaster({ userName: "Ann", userColor: "#f00", throttleMs: 0, getSendDeps: () => sendDeps });

    broadcaster.sendReaction("👍");
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    broadcaster.republish();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));

    const payloads = await sentPayloads(send, sendDeps);
    expect(payloads[0]!.reaction).toBeDefined();
    expect(payloads[1]!.reaction).toBeUndefined();
  });

  it("keeps a reaction pending when there is nothing to send over, rather than dropping it", async () => {
    const send = vi.fn<(data: string) => boolean>(() => true);
    const sendDeps = await freshSendDeps(send);
    let connected = false;
    const broadcaster = new PresenceBroadcaster({ userName: "Ann", userColor: "#f00", throttleMs: 0, getSendDeps: () => (connected ? sendDeps : null) });

    broadcaster.sendReaction("👏");
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();

    connected = true;
    broadcaster.republish();
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect((await sentPayloads(send, sendDeps))[0]!.reaction).toMatchObject({ emoji: "👏" });
  });

  it("keeps a raised hand on every broadcast until it is lowered", async () => {
    const send = vi.fn<(data: string) => boolean>(() => true);
    const sendDeps = await freshSendDeps(send);
    const broadcaster = new PresenceBroadcaster({ userName: "Ann", userColor: "#f00", throttleMs: 0, getSendDeps: () => sendDeps });

    broadcaster.setHandRaised(true);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    broadcaster.republish();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    broadcaster.setHandRaised(false);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));

    const payloads = await sentPayloads(send, sendDeps);
    expect(payloads[0]!.handRaised).toBe(true);
    expect(payloads[1]!.handRaised).toBe(true);
    expect(payloads[2]!.handRaised).toBeUndefined();
  });

  it("ignores an empty reaction and caps an over-long one instead of putting it on the wire", async () => {
    const send = vi.fn<(data: string) => boolean>(() => true);
    const sendDeps = await freshSendDeps(send);
    const broadcaster = new PresenceBroadcaster({ userName: "Ann", userColor: "#f00", throttleMs: 0, getSendDeps: () => sendDeps });

    broadcaster.sendReaction("");
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();

    broadcaster.sendReaction("x".repeat(500));
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(((await sentPayloads(send, sendDeps))[0]!.reaction as { emoji: string }).emoji).toHaveLength(MAX_REACTION_EMOJI_LENGTH);
  });

  it("does not re-send a reaction after reset", async () => {
    const send = vi.fn<(data: string) => boolean>(() => true);
    const sendDeps = await freshSendDeps(send);
    let connected = false;
    const broadcaster = new PresenceBroadcaster({ userName: "Ann", userColor: "#f00", throttleMs: 0, getSendDeps: () => (connected ? sendDeps : null) });

    broadcaster.sendReaction("❤️");
    broadcaster.setHandRaised(true);
    broadcaster.reset();
    connected = true;
    broadcaster.republish();
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    const payload = (await sentPayloads(send, sendDeps))[0]!;
    expect(payload.reaction).toBeUndefined();
    expect(payload.handRaised).toBeUndefined();
  });
});
