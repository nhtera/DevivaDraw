/**
 * Ephemeral collaborator presence: cursor position, live selection, display name/color, an optional
 * viewport (for follow-mode), and idle detection — deliberately kept out of LWW merge and the room
 * snapshot (`apps/collab-server` never persists any of this): a disconnected peer's last-known cursor
 * must vanish the moment they leave, never linger as merged/stale data the way a soft-deleted element
 * intentionally does. Idle-ness is derived from wall-clock time since the last presence update was
 * received, not a field the sender computes and transmits — a peer who stops moving simply stops
 * sending updates (see `collab-session.ts`'s throttled outbound cursor sync), so no extra wire field is
 * needed and every observer converges on the same "idle" verdict independently.
 */
/**
 * A peer's visible region, expressed as the SCENE point at the centre of their screen plus their
 * zoom — not their raw camera scroll. Two peers on differently-sized screens have different scroll
 * offsets for the same view, so relaying scroll would land a follower somewhere else entirely; a
 * centre point is the one description of "what I am looking at" that survives the window-size
 * difference. The follower matches the zoom exactly and centres on the same point, so a wider
 * window simply sees more around the same content.
 */
export interface PresenceViewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * A one-shot emoji reaction. `at` is the SENDER's clock, used only as an identity for the reaction
 * (de-duplicating the repeats that ride the next few throttled presence broadcasts) — never to decide
 * whether it is recent. Receivers age reactions against their own clock from the moment they first see
 * one, so a peer with a badly-set clock cannot make a reaction stick forever or never appear at all.
 */
export interface PresenceReaction {
  emoji: string;
  at: number;
}

/**
 * Emoji are multi-code-point (skin tones, ZWJ sequences, variation selectors), so the cap is generous
 * in characters while still being a cap: presence is the one channel here that is otherwise unbounded
 * in content, and an unbounded string on it is a trivial abuse vector.
 */
export const MAX_REACTION_EMOJI_LENGTH = 16;

/** The reactions the UI offers. Not a validation whitelist — a peer may send any short string, and rendering it as text is safe — but it is what this client will ever send. */
export const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "👏", "❓"] as const;

/** The decrypted, still-untrusted wire shape of an inbound presence update. */
export interface PresencePayload {
  name: string;
  color: string;
  point: { x: number; y: number } | null;
  selectedElementIds: string[];
  viewport: PresenceViewport | null;
  /** Which page the peer is on (multi-page sessions) — absent/`undefined` from single-scene peers, which renderers treat as "every page". */
  pageId?: string;
  /** The peer's most recent reaction, if any. Ephemeral like the rest of presence: it is never persisted, never merged, and disappears with the peer. */
  reaction?: PresenceReaction;
  /** Whether the peer is asking to speak. A sticky flag (unlike `reaction`) — it stays until the peer lowers it or leaves. */
  handRaised?: boolean;
}

/** A peer's presence as the local UI renders it — `idle` is computed fresh on every `list()` call, not stored. */
export interface RemotePeerPresence extends PresencePayload {
  peerId: string;
  idle: boolean;
}

const IDLE_THRESHOLD_MS = 10_000;
/** How often the store re-evaluates every peer's `idle` flag purely from the wall clock, even with no new network traffic — see the module doc for why idle-ness has no dedicated wire field. */
const DEFAULT_IDLE_TICK_MS = 2_000;

/** Rejects a malformed/hostile inbound presence payload rather than trusting attacker-controlled JSON. */
export function isPlausiblePresencePayload(value: unknown): value is PresencePayload {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  if (typeof p.name !== "string" || typeof p.color !== "string") return false;
  if (!Array.isArray(p.selectedElementIds) || !p.selectedElementIds.every((id) => typeof id === "string")) return false;
  if (p.point !== null && !isPoint(p.point)) return false;
  if (p.viewport !== null && !isViewport(p.viewport)) return false;
  if (p.pageId !== undefined && typeof p.pageId !== "string") return false;
  if (p.handRaised !== undefined && typeof p.handRaised !== "boolean") return false;
  if (p.reaction !== undefined && !isReaction(p.reaction)) return false;
  return true;
}

function isReaction(value: unknown): value is PresenceReaction {
  if (typeof value !== "object" || value === null) return false;
  const reaction = value as Record<string, unknown>;
  if (typeof reaction.emoji !== "string" || reaction.emoji.length === 0 || reaction.emoji.length > MAX_REACTION_EMOJI_LENGTH) return false;
  return typeof reaction.at === "number" && Number.isFinite(reaction.at);
}

function isPoint(value: unknown): value is { x: number; y: number } {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Record<string, unknown>;
  return typeof point.x === "number" && typeof point.y === "number";
}

function isViewport(value: unknown): value is PresenceViewport {
  if (typeof value !== "object" || value === null) return false;
  const viewport = value as Record<string, unknown>;
  return typeof viewport.x === "number" && typeof viewport.y === "number" && typeof viewport.zoom === "number";
}

export type PresenceListener = () => void;

interface StoredPeer {
  payload: PresencePayload;
  lastSeenAt: number;
}

export class PresenceStore {
  private readonly peers = new Map<string, StoredPeer>();
  private readonly listeners = new Set<PresenceListener>();
  private idleTickTimer: ReturnType<typeof setInterval> | null = null;

  subscribe(listener: PresenceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Every currently-known peer, most-recently-updated last, with `idle` computed against `now`. */
  list(now: number = Date.now()): RemotePeerPresence[] {
    return [...this.peers.entries()].map(([peerId, stored]) => ({
      peerId,
      ...stored.payload,
      idle: now - stored.lastSeenAt > IDLE_THRESHOLD_MS,
    }));
  }

  get(peerId: string): RemotePeerPresence | undefined {
    return this.list().find((peer) => peer.peerId === peerId);
  }

  /** Upserts `peerId`'s presence from a validated payload; rejects (returns `false`, no-ops) a malformed one instead of throwing. */
  applyUpdate(peerId: string, payload: unknown, now: number = Date.now()): boolean {
    if (!isPlausiblePresencePayload(payload)) return false;
    this.peers.set(peerId, { payload, lastSeenAt: now });
    this.notifyListeners();
    return true;
  }

  /** Removes a peer entirely (on `peer-left`) — presence never lingers as a stale/merged entry the way a soft-deleted element does. */
  removePeer(peerId: string): void {
    if (this.peers.delete(peerId)) this.notifyListeners();
  }

  clear(): void {
    if (this.peers.size === 0) return;
    this.peers.clear();
    this.notifyListeners();
  }

  /** Starts the wall-clock idle re-evaluation tick; returns a disposer. Idempotent — calling it again while already ticking just restarts the interval, so a caller doesn't need to track whether it already started one. */
  startIdleTicking(intervalMs = DEFAULT_IDLE_TICK_MS): () => void {
    if (this.idleTickTimer !== null) clearInterval(this.idleTickTimer);
    this.idleTickTimer = setInterval(() => this.notifyListeners(), intervalMs);
    return () => {
      if (this.idleTickTimer !== null) clearInterval(this.idleTickTimer);
      this.idleTickTimer = null;
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Leading+trailing throttle for the local user's own outbound cursor updates — at most one call to `fn` per `intervalMs`, plus one final trailing call carrying the latest arguments so the last known position is never dropped. */
export function throttle<Args extends unknown[]>(fn: (...args: Args) => void, intervalMs: number): (...args: Args) => void {
  let lastCallAt = 0;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;
  let trailingArgs: Args | null = null;

  return (...args: Args) => {
    const now = Date.now();
    const elapsed = now - lastCallAt;
    if (elapsed >= intervalMs) {
      lastCallAt = now;
      fn(...args);
      return;
    }
    trailingArgs = args;
    if (trailingTimer !== null) return;
    trailingTimer = setTimeout(() => {
      trailingTimer = null;
      lastCallAt = Date.now();
      if (trailingArgs) fn(...trailingArgs);
    }, intervalMs - elapsed);
  };
}
