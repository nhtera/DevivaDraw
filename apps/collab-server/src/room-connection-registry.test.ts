import { describe, expect, it, vi } from "vitest";
import { MAX_MESSAGE_LENGTH, RoomConnectionRegistry } from "./room-connection-registry";
import type { RoomSocket } from "./room-connection-registry";
import { RateLimiter } from "./rate-limit";

function fakeSocket(): RoomSocket & { received: string[]; closeCalls: Array<{ code?: number; reason?: string }> } {
  const received: string[] = [];
  const closeCalls: Array<{ code?: number; reason?: string }> = [];
  return {
    received,
    closeCalls,
    send: (data) => received.push(data),
    close: (code, reason) => closeCalls.push({ code, reason }),
  };
}

function unlimitedLimiter(): RateLimiter {
  return new RateLimiter({ maxRequests: Number.MAX_SAFE_INTEGER, windowMs: 60_000 });
}

describe("RoomConnectionRegistry — join/leave", () => {
  it("announces a new peer to existing members, but not to itself", () => {
    const registry = new RoomConnectionRegistry({ limiter: unlimitedLimiter() });
    const alice = fakeSocket();
    const bob = fakeSocket();
    registry.join("alice", alice);
    registry.join("bob", bob);

    expect(alice.received).toEqual([JSON.stringify({ type: "peer-joined", peerId: "bob" })]);
    expect(bob.received).toEqual([]);
    expect(registry.connectionCount).toBe(2);
  });

  it("announces a departure and stops tracking the connection", () => {
    const registry = new RoomConnectionRegistry({ limiter: unlimitedLimiter() });
    const alice = fakeSocket();
    const bob = fakeSocket();
    registry.join("alice", alice);
    registry.join("bob", bob);
    alice.received.length = 0;

    registry.leave("bob");

    expect(alice.received).toEqual([JSON.stringify({ type: "peer-left", peerId: "bob" })]);
    expect(registry.connectionCount).toBe(1);
  });

  it("leaving an unknown peerId is a harmless no-op", () => {
    const registry = new RoomConnectionRegistry({ limiter: unlimitedLimiter() });
    expect(() => registry.leave("ghost")).not.toThrow();
    expect(registry.connectionCount).toBe(0);
  });
});

describe("RoomConnectionRegistry — relay", () => {
  it("broadcasts an element-delta to every other connection, stamped with the sender's peerId", () => {
    const registry = new RoomConnectionRegistry({ limiter: unlimitedLimiter() });
    const alice = fakeSocket();
    const bob = fakeSocket();
    const carol = fakeSocket();
    registry.join("alice", alice);
    registry.join("bob", bob);
    registry.join("carol", carol);
    [alice, bob, carol].forEach((s) => (s.received.length = 0));

    registry.handleMessage("alice", JSON.stringify({ type: "element-delta", iv: "iv1", ciphertext: "ct1" }));

    const expected = JSON.stringify({ type: "element-delta", iv: "iv1", ciphertext: "ct1", peerId: "alice" });
    expect(alice.received).toEqual([]);
    expect(bob.received).toEqual([expected]);
    expect(carol.received).toEqual([expected]);
  });

  it("broadcasts a presence message the same way as an element-delta", () => {
    const registry = new RoomConnectionRegistry({ limiter: unlimitedLimiter() });
    const alice = fakeSocket();
    const bob = fakeSocket();
    registry.join("alice", alice);
    registry.join("bob", bob);
    bob.received.length = 0;

    registry.handleMessage("alice", JSON.stringify({ type: "presence", iv: "iv1", ciphertext: "ct1" }));

    expect(bob.received).toEqual([JSON.stringify({ type: "presence", iv: "iv1", ciphertext: "ct1", peerId: "alice" })]);
  });

  it("relays a comment-delta exactly like an element-delta — the relay cannot tell a comment from a shape", () => {
    const registry = new RoomConnectionRegistry({ limiter: unlimitedLimiter() });
    const alice = fakeSocket();
    const bob = fakeSocket();
    registry.join("alice", alice);
    registry.join("bob", bob);
    [alice, bob].forEach((s) => (s.received.length = 0));

    registry.handleMessage("alice", JSON.stringify({ type: "comment-delta", iv: "iv1", ciphertext: "ct1" }));

    expect(alice.received).toEqual([]);
    expect(bob.received).toEqual([JSON.stringify({ type: "comment-delta", iv: "iv1", ciphertext: "ct1", peerId: "alice" })]);
  });

  it("drops malformed JSON without throwing or broadcasting anything", () => {
    const registry = new RoomConnectionRegistry({ limiter: unlimitedLimiter() });
    const alice = fakeSocket();
    const bob = fakeSocket();
    registry.join("alice", alice);
    registry.join("bob", bob);
    bob.received.length = 0;

    expect(() => registry.handleMessage("alice", "{not json")).not.toThrow();
    expect(bob.received).toEqual([]);
  });

  it.each(["null", "42", '"a string"', "[]", "{}", '{"type":123}', '{"type":"drop-table"}'])(
    "drops a structurally invalid or unrecognized message: %s",
    (raw) => {
      const registry = new RoomConnectionRegistry({ limiter: unlimitedLimiter() });
      const alice = fakeSocket();
      const bob = fakeSocket();
      registry.join("alice", alice);
      registry.join("bob", bob);
      bob.received.length = 0;

      registry.handleMessage("alice", raw);

      expect(bob.received).toEqual([]);
    },
  );

  it("closes the connection with 1009 (Message Too Big) when a frame exceeds MAX_MESSAGE_LENGTH, instead of broadcasting it", () => {
    const registry = new RoomConnectionRegistry({ limiter: unlimitedLimiter() });
    const alice = fakeSocket();
    const bob = fakeSocket();
    registry.join("alice", alice);
    registry.join("bob", bob);
    bob.received.length = 0;

    const oversized = JSON.stringify({ type: "element-delta", iv: "i", ciphertext: "x".repeat(MAX_MESSAGE_LENGTH) });
    registry.handleMessage("alice", oversized);

    expect(alice.closeCalls).toEqual([{ code: 1009, reason: "message too large" }]);
    expect(bob.received).toEqual([]);
  });

  it("accepts a frame exactly at MAX_MESSAGE_LENGTH (the cap rejects strictly-over, not at-or-over)", () => {
    const registry = new RoomConnectionRegistry({ limiter: unlimitedLimiter() });
    const alice = fakeSocket();
    const bob = fakeSocket();
    registry.join("alice", alice);
    registry.join("bob", bob);
    bob.received.length = 0;

    const padding = "x".repeat(MAX_MESSAGE_LENGTH - JSON.stringify({ type: "presence", iv: "i", ciphertext: "" }).length);
    const atCap = JSON.stringify({ type: "presence", iv: "i", ciphertext: padding });
    expect(atCap.length).toBe(MAX_MESSAGE_LENGTH);

    registry.handleMessage("alice", atCap);

    expect(alice.closeCalls).toEqual([]);
    expect(bob.received).toHaveLength(1);
  });

  it("closes the connection once its per-connection rate limit is exceeded, instead of just dropping the message", () => {
    const registry = new RoomConnectionRegistry({ limiter: new RateLimiter({ maxRequests: 1, windowMs: 60_000 }) });
    const alice = fakeSocket();
    const bob = fakeSocket();
    registry.join("alice", alice);
    registry.join("bob", bob);
    bob.received.length = 0;

    registry.handleMessage("alice", JSON.stringify({ type: "presence", iv: "i", ciphertext: "c" }));
    registry.handleMessage("alice", JSON.stringify({ type: "presence", iv: "i2", ciphertext: "c2" }));

    expect(bob.received).toHaveLength(1);
    expect(alice.closeCalls).toEqual([{ code: 1013, reason: "rate limit exceeded" }]);
  });
});

describe("RoomConnectionRegistry — snapshot fast path vs broadcast-request", () => {
  it("unicasts a cached snapshot directly to the requester without broadcasting to others", () => {
    const registry = new RoomConnectionRegistry({ limiter: unlimitedLimiter() });
    const alice = fakeSocket();
    const bob = fakeSocket();
    const carol = fakeSocket();
    registry.join("alice", alice);
    registry.join("bob", bob);

    registry.handleMessage("alice", JSON.stringify({ type: "snapshot", iv: "iv-s", ciphertext: "ct-s" }));
    registry.join("carol", carol);
    bob.received.length = 0; // clear the "peer-joined" broadcast carol's own join just triggered

    registry.handleMessage("carol", JSON.stringify({ type: "snapshot-request" }));

    expect(carol.received).toEqual([JSON.stringify({ type: "snapshot", iv: "iv-s", ciphertext: "ct-s", peerId: "alice" })]);
    expect(bob.received).toEqual([]); // fast path: no need to bother the other live peer
    expect(alice.received.filter((m) => m.includes("snapshot-request"))).toEqual([]);
  });

  it("broadcasts snapshot-request to other peers when no snapshot has ever been seen", () => {
    const registry = new RoomConnectionRegistry({ limiter: unlimitedLimiter() });
    const alice = fakeSocket();
    const bob = fakeSocket();
    registry.join("alice", alice);
    registry.join("bob", bob);
    alice.received.length = 0;

    registry.handleMessage("bob", JSON.stringify({ type: "snapshot-request" }));

    expect(alice.received).toEqual([JSON.stringify({ type: "snapshot-request" })]);
    expect(bob.received).toEqual([]); // never echoed back to the requester itself
  });

  it("invokes onSnapshotReceived exactly once per snapshot message, for R2 persistence", () => {
    const onSnapshotReceived = vi.fn();
    const registry = new RoomConnectionRegistry({ limiter: unlimitedLimiter(), onSnapshotReceived });
    const alice = fakeSocket();
    registry.join("alice", alice);

    registry.handleMessage("alice", JSON.stringify({ type: "snapshot", iv: "i", ciphertext: "c" }));

    expect(onSnapshotReceived).toHaveBeenCalledOnce();
    expect(onSnapshotReceived).toHaveBeenCalledWith(JSON.stringify({ type: "snapshot", iv: "i", ciphertext: "c", peerId: "alice" }));
  });

  it("seedSnapshot populates the fast path without treating it as freshly received", () => {
    const onSnapshotReceived = vi.fn();
    const registry = new RoomConnectionRegistry({ limiter: unlimitedLimiter(), onSnapshotReceived });
    const alice = fakeSocket();
    registry.join("alice", alice);

    const seeded = JSON.stringify({ type: "snapshot", iv: "seed-iv", ciphertext: "seed-ct", peerId: "prior-peer" });
    registry.seedSnapshot(seeded);
    registry.handleMessage("alice", JSON.stringify({ type: "snapshot-request" }));

    expect(alice.received).toEqual([seeded]);
    expect(onSnapshotReceived).not.toHaveBeenCalled();
  });
});
