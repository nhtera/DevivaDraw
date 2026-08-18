import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPlausiblePresencePayload, MAX_REACTION_EMOJI_LENGTH, PresenceStore, throttle } from "./presence-state";

const VALID_PAYLOAD = { name: "Alice", color: "#ff0000", point: { x: 1, y: 2 }, selectedElementIds: ["a", "b"], viewport: null };

describe("isPlausiblePresencePayload", () => {
  it("accepts a well-formed payload, including a null point/viewport", () => {
    expect(isPlausiblePresencePayload(VALID_PAYLOAD)).toBe(true);
    expect(isPlausiblePresencePayload({ ...VALID_PAYLOAD, viewport: { x: 0, y: 0, zoom: 1 } })).toBe(true);
  });

  it.each([null, undefined, "x", 1, [], {}, { ...VALID_PAYLOAD, name: 1 }, { ...VALID_PAYLOAD, point: { x: "1" } }, { ...VALID_PAYLOAD, selectedElementIds: [1] }, { ...VALID_PAYLOAD, viewport: { x: 1 } }])(
    "rejects malformed/hostile input: %j",
    (value) => {
      expect(isPlausiblePresencePayload(value)).toBe(false);
    },
  );

  it("accepts an absent reaction/hand — every payload written before those fields existed", () => {
    expect(isPlausiblePresencePayload({ ...VALID_PAYLOAD, reaction: undefined, handRaised: undefined })).toBe(true);
  });

  it("accepts a well-formed reaction and raised hand", () => {
    expect(isPlausiblePresencePayload({ ...VALID_PAYLOAD, reaction: { emoji: "🎉", at: 1000 }, handRaised: true })).toBe(true);
  });

  it.each([
    { ...VALID_PAYLOAD, handRaised: "yes" },
    { ...VALID_PAYLOAD, reaction: { emoji: "🎉" } },
    { ...VALID_PAYLOAD, reaction: { emoji: 1, at: 1 } },
    { ...VALID_PAYLOAD, reaction: { emoji: "", at: 1 } },
    { ...VALID_PAYLOAD, reaction: { emoji: "🎉", at: Number.NaN } },
    // The abuse case the cap exists for: presence is otherwise unbounded in content.
    { ...VALID_PAYLOAD, reaction: { emoji: "x".repeat(MAX_REACTION_EMOJI_LENGTH + 1), at: 1 } },
  ])("rejects a malformed reaction/hand: %j", (value) => {
    expect(isPlausiblePresencePayload(value)).toBe(false);
  });
});

describe("PresenceStore", () => {
  it("upserts and lists a valid presence update", () => {
    const store = new PresenceStore();
    expect(store.applyUpdate("peer-1", VALID_PAYLOAD, 1_000)).toBe(true);
    const list = store.list(1_000);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ peerId: "peer-1", name: "Alice", idle: false });
  });

  it("rejects a malformed update without storing it", () => {
    const store = new PresenceStore();
    expect(store.applyUpdate("peer-1", { junk: true })).toBe(false);
    expect(store.list()).toHaveLength(0);
  });

  it("notifies subscribers on upsert and on removal", () => {
    const store = new PresenceStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.applyUpdate("peer-1", VALID_PAYLOAD);
    expect(listener).toHaveBeenCalledTimes(1);
    store.removePeer("peer-1");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.list()).toHaveLength(0);
  });

  it("removePeer/clear on an unknown or empty store is a no-op that doesn't notify", () => {
    const store = new PresenceStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.removePeer("nobody");
    store.clear();
    expect(listener).not.toHaveBeenCalled();
  });

  it("derives idle purely from elapsed wall-clock time since the last update, no stored flag", () => {
    const store = new PresenceStore();
    store.applyUpdate("peer-1", VALID_PAYLOAD, 0);
    expect(store.list(5_000)[0]!.idle).toBe(false);
    expect(store.list(10_001)[0]!.idle).toBe(true);
  });

  describe("startIdleTicking", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("notifies listeners on an interval even with no presence updates, and the disposer stops it", () => {
      const store = new PresenceStore();
      const listener = vi.fn();
      store.subscribe(listener);
      const dispose = store.startIdleTicking(1_000);

      vi.advanceTimersByTime(3_000);
      expect(listener).toHaveBeenCalledTimes(3);

      dispose();
      vi.advanceTimersByTime(3_000);
      expect(listener).toHaveBeenCalledTimes(3);
    });

    it("restarts cleanly when called twice instead of leaking a duplicate interval", () => {
      const store = new PresenceStore();
      const listener = vi.fn();
      store.subscribe(listener);
      store.startIdleTicking(1_000);
      store.startIdleTicking(1_000);

      vi.advanceTimersByTime(1_000);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});

describe("throttle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("calls immediately on the leading edge", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it("suppresses calls within the interval but delivers the latest args on the trailing edge", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled("first");
    throttled("second");
    throttled("third");
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("third");
  });

  it("allows an immediate call again once the interval has fully elapsed", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled("a");
    vi.advanceTimersByTime(150);
    throttled("b");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("b");
  });
});
