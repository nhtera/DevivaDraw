/**
 * Turns the presence stream into a queue of reactions to animate.
 *
 * Presence is a state snapshot, not an event stream: the same reaction can appear in several
 * consecutive `peers` values, and a re-render for an unrelated reason re-delivers the whole list. So
 * each reaction is identified by `(peerId, at)` and shown exactly once — `at` is the sender's clock
 * used purely as an identity, never compared against the local one, because a peer with a wrong clock
 * would otherwise have every reaction either dropped or stuck.
 *
 * Age is measured from when THIS client first saw a reaction, which is also what makes a late joiner
 * see no backlog: presence carries only the most recent reaction, and it was already cleared from the
 * sender's payload after one broadcast (see `PresenceBroadcaster.sendReaction`), so a peer arriving
 * later receives nothing to replay.
 */
import { useEffect, useRef, useState } from "react";
import type { RemotePeerPresence } from "@deviva-draw/collab-client";

/** How long a reaction floats before it is dropped. Long enough to read, short enough not to cover the board. */
export const REACTION_LIFETIME_MS = 2600;
/**
 * How long a `(peerId, at)` key is remembered as "already shown". Far longer than the lifetime on
 * purpose: forgetting a key while its sender is still broadcasting it would replay the same reaction.
 */
const SEEN_RETENTION_MS = 60_000;
/** Prune cadence. The list is tiny, so this is about the animation ending on time, not about cost. */
const TICK_MS = 300;

export interface FloatingReaction {
  /** `peerId:at` — stable across re-renders, so React keeps one DOM node per reaction for its whole animation. */
  key: string;
  peerId: string;
  emoji: string;
  /** Who sent it, for the label beside the emoji. */
  name: string;
  color: string;
  /** The sender's cursor in scene coordinates when the reaction arrived, or `null` when they have no cursor on this page. */
  point: { x: number; y: number } | null;
  /** Local timestamp of first sighting — the animation's origin. */
  bornAt: number;
}

/**
 * The reactions in `peers` that `seen` has not recorded yet, recording them as it goes. Pure but for
 * that mutation, and separated from the hook so the de-duplication rule — the part that actually
 * decides whether a reaction shows once, twice, or never — is unit testable in a package that does not
 * test hooks (see `runtime/use-live-version.ts`'s module doc).
 */
export function collectNewReactions(peers: readonly RemotePeerPresence[], seen: Map<string, number>, now: number): FloatingReaction[] {
  const fresh: FloatingReaction[] = [];
  for (const peer of peers) {
    if (!peer.reaction) continue;
    const key = `${peer.peerId}:${peer.reaction.at}`;
    if (seen.has(key)) continue;
    seen.set(key, now);
    fresh.push({ key, peerId: peer.peerId, emoji: peer.reaction.emoji, name: peer.name, color: peer.color, point: peer.point, bornAt: now });
  }
  return fresh;
}

/** Drops `seen` keys older than the retention window, so a long session's map does not grow without bound. */
export function pruneSeen(seen: Map<string, number>, now: number): void {
  for (const [key, at] of seen) if (now - at > SEEN_RETENTION_MS) seen.delete(key);
}

/** The reactions still inside their display window. Returns `current` unchanged when nothing expired, so a steady state does not re-render every tick. */
export function keepLiveReactions(current: readonly FloatingReaction[], now: number): readonly FloatingReaction[] {
  const kept = current.filter((reaction) => now - reaction.bornAt < REACTION_LIFETIME_MS);
  return kept.length === current.length ? current : kept;
}

export function usePeerReactions(peers: readonly RemotePeerPresence[]): FloatingReaction[] {
  const [active, setActive] = useState<FloatingReaction[]>([]);
  const seenRef = useRef(new Map<string, number>());

  useEffect(() => {
    const fresh = collectNewReactions(peers, seenRef.current, Date.now());
    if (fresh.length > 0) setActive((current) => [...current, ...fresh]);
  }, [peers]);

  useEffect(() => {
    if (active.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      pruneSeen(seenRef.current, now);
      setActive((current) => keepLiveReactions(current, now) as FloatingReaction[]);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [active.length]);

  return active;
}

/** Peers currently asking to speak, in the order presence reports them. */
export function raisedHands(peers: readonly RemotePeerPresence[]): RemotePeerPresence[] {
  return peers.filter((peer) => peer.handRaised === true);
}
