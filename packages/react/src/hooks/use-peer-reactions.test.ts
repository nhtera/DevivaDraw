import { describe, expect, it } from "vitest";
import type { RemotePeerPresence } from "@deviva-draw/collab-client";
import { collectNewReactions, keepLiveReactions, pruneSeen, raisedHands, REACTION_LIFETIME_MS } from "./use-peer-reactions";

function peer(overrides: Partial<RemotePeerPresence> & { peerId: string }): RemotePeerPresence {
  return { name: "Ann", color: "#f00", point: { x: 1, y: 2 }, selectedElementIds: [], viewport: null, idle: false, ...overrides };
}

describe("collectNewReactions", () => {
  it("surfaces a reaction once, no matter how many presence snapshots repeat it", () => {
    const seen = new Map<string, number>();
    const peers = [peer({ peerId: "p1", reaction: { emoji: "🎉", at: 1000 } })];
    expect(collectNewReactions(peers, seen, 5)).toHaveLength(1);
    expect(collectNewReactions(peers, seen, 6)).toEqual([]);
    expect(collectNewReactions(peers, seen, 7)).toEqual([]);
  });

  it("treats the same peer's next reaction as new, including the same emoji again", () => {
    const seen = new Map<string, number>();
    collectNewReactions([peer({ peerId: "p1", reaction: { emoji: "👍", at: 1000 } })], seen, 5);
    const again = collectNewReactions([peer({ peerId: "p1", reaction: { emoji: "👍", at: 2000 } })], seen, 6);
    expect(again.map((reaction) => reaction.key)).toEqual(["p1:2000"]);
  });

  it("keys by peer as well as time, so two peers reacting on the same clock both show", () => {
    const seen = new Map<string, number>();
    const fresh = collectNewReactions(
      [peer({ peerId: "p1", reaction: { emoji: "👍", at: 1000 } }), peer({ peerId: "p2", name: "Bo", reaction: { emoji: "❤️", at: 1000 } })],
      seen,
      5,
    );
    expect(fresh.map((reaction) => reaction.key)).toEqual(["p1:1000", "p2:1000"]);
  });

  it("dates a reaction by the local clock, not the sender's — a wrong remote clock must not decide its lifetime", () => {
    const fresh = collectNewReactions([peer({ peerId: "p1", reaction: { emoji: "👏", at: 0 } })], new Map(), 12_345);
    expect(fresh[0]!.bornAt).toBe(12_345);
  });

  it("ignores peers with no reaction", () => {
    expect(collectNewReactions([peer({ peerId: "p1" })], new Map(), 5)).toEqual([]);
  });

  it("carries the sender's cursor, or null when they have none on this page", () => {
    const fresh = collectNewReactions(
      [peer({ peerId: "p1", reaction: { emoji: "❓", at: 1 } }), peer({ peerId: "p2", point: null, reaction: { emoji: "❓", at: 1 } })],
      new Map(),
      5,
    );
    expect(fresh[0]!.point).toEqual({ x: 1, y: 2 });
    expect(fresh[1]!.point).toBeNull();
  });
});

describe("reaction expiry", () => {
  it("keeps a reaction inside its window and drops it after", () => {
    const [reaction] = collectNewReactions([peer({ peerId: "p1", reaction: { emoji: "🎉", at: 1 } })], new Map(), 1000);
    const live = [reaction!];
    expect(keepLiveReactions(live, 1000 + REACTION_LIFETIME_MS - 1)).toHaveLength(1);
    expect(keepLiveReactions(live, 1000 + REACTION_LIFETIME_MS)).toHaveLength(0);
  });

  it("returns the same array when nothing expired, so a steady state causes no re-render", () => {
    const [reaction] = collectNewReactions([peer({ peerId: "p1", reaction: { emoji: "🎉", at: 1 } })], new Map(), 1000);
    const live = [reaction!];
    expect(keepLiveReactions(live, 1100)).toBe(live);
  });

  it("forgets seen keys only long after they could still be arriving", () => {
    const seen = new Map<string, number>();
    collectNewReactions([peer({ peerId: "p1", reaction: { emoji: "🎉", at: 1 } })], seen, 0);
    pruneSeen(seen, REACTION_LIFETIME_MS * 2);
    expect(seen.size, "still within retention — pruning here would replay the reaction").toBe(1);
    pruneSeen(seen, 120_000);
    expect(seen.size).toBe(0);
  });
});

describe("raisedHands", () => {
  it("lists only the peers whose hand is up", () => {
    const peers = [peer({ peerId: "p1", handRaised: true }), peer({ peerId: "p2" }), peer({ peerId: "p3", handRaised: false })];
    expect(raisedHands(peers).map((entry) => entry.peerId)).toEqual(["p1"]);
  });
});
