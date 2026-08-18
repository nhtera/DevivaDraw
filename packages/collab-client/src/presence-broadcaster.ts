/**
 * Owns the local user's outbound presence state (cursor/selection/viewport) and the throttled send path
 * — split out of `collab-session.ts` to keep that file's connection/timer lifecycle readable, and
 * because reconnect-triggered republishing (`republish`) needs to resend whatever was last set
 * regardless of whether a `pointermove` happens to fire again right after reconnecting: other peers'
 * view of this client's cursor is otherwise stuck at whatever it was before the drop until the next
 * throttled `updateCursor` call, which could be arbitrarily far in the future if the pointer just isn't
 * moving.
 */
import { sendPresenceUpdate } from "./outbound-sync";
import type { PresencePayload, PresenceReaction, PresenceViewport } from "./presence-state";
import { MAX_REACTION_EMOJI_LENGTH, throttle } from "./presence-state";

export interface PresenceSendDeps {
  roomKey: CryptoKey;
  send(data: string): boolean;
}

export interface PresenceBroadcasterOptions {
  userName: string;
  userColor: string;
  /** Resolved lazily on every send (not captured once) since the room key/connection can become unavailable — or a different one, across a reconnect — between calls; `null` means "nothing to send to right now", a silent no-op rather than an error. */
  getSendDeps(): PresenceSendDeps | null;
  throttleMs: number;
}

export class PresenceBroadcaster {
  private lastPoint: { x: number; y: number } | null = null;
  private lastSelectedElementIds: string[] = [];
  private lastViewport: PresenceViewport | null = null;
  private lastPageId: string | null = null;
  /** A reaction waiting to go out. One-shot: cleared once a send is attempted over a live connection — so it rides exactly one broadcast rather than repeating on every later cursor move. "Attempted", not "delivered": if that send throws, the reaction is gone, which is the same lossiness a dropped packet has and is deliberate (see `sendReaction`). */
  private pendingReaction: PresenceReaction | null = null;
  /** Sticky, unlike a reaction — it rides every broadcast until lowered, so a peer joining mid-session still sees the hand. */
  private handRaised = false;
  private readonly throttledSend: (point: { x: number; y: number } | null) => void;

  constructor(private readonly options: PresenceBroadcasterOptions) {
    this.throttledSend = throttle((point) => {
      this.lastPoint = point;
      void this.send(point);
    }, options.throttleMs);
  }

  /** Publishes the local user's live cursor position; throttled internally — safe to call on every `pointermove`. */
  updateCursor(point: { x: number; y: number } | null): void {
    this.throttledSend(point);
  }

  /** Updates the locally-tracked selection that rides along with the next throttled cursor broadcast — piggybacks on that throttle rather than running a second independent one. */
  setLocalSelection(selectedElementIds: string[]): void {
    this.lastSelectedElementIds = selectedElementIds;
  }

  /**
   * Publishes the local user's visible region (see `PresenceViewport`) for follow-mode.
   *
   * Unlike `setLocalSelection`, this does NOT just wait for the next cursor broadcast to carry it:
   * a wheel zoom, a keyboard pan, or a zoom-menu jump moves the view without moving the pointer, and
   * a follower whose camera only updated when the presenter happened to twitch the mouse would sit
   * on a stale view for as long as the presenter kept still. It goes through the same cursor throttle
   * rather than a second one, so a drag-pan (which fires both) still costs one broadcast per tick.
   */
  setLocalViewport(viewport: PresenceViewport | null): void {
    if (sameViewport(this.lastViewport, viewport)) return;
    this.lastViewport = viewport;
    this.throttledSend(this.lastPoint);
  }

  /** Which page the local user is looking at — rides with the next broadcast so peers can keep foreign-page cursors off their canvas. `null` in single-scene sessions (the field is simply absent on the wire). */
  setLocalPage(pageId: string | null): void {
    if (this.lastPageId === pageId) return;
    this.lastPageId = pageId;
    // A page switch should be visible promptly (the peer's cursor must vanish from the old page), so it republishes rather than waiting for the next pointer move.
    void this.send(this.lastPoint);
  }

  /**
   * Sends a one-shot emoji reaction, bypassing the throttle so it lands within a tick rather than
   * whenever the pointer next happens to move.
   *
   * Lossy by design: it rides exactly one presence broadcast and is not retransmitted, which is the
   * whole reason it can ride presence instead of needing a delivery-guaranteed wire type. A peer that
   * misses the packet simply never saw that reaction — the correct outcome for something that would
   * be stale by the time a retry arrived, and what keeps a late joiner from replaying a backlog.
   */
  sendReaction(emoji: string): void {
    const trimmed = emoji.slice(0, MAX_REACTION_EMOJI_LENGTH);
    if (trimmed === "") return;
    this.pendingReaction = { emoji: trimmed, at: Date.now() };
    void this.send(this.lastPoint);
  }

  /** Raises or lowers the local user's hand. Republished immediately: a raised hand that waited for the next pointer move would be an ask nobody heard. */
  setHandRaised(raised: boolean): void {
    if (this.handRaised === raised) return;
    this.handRaised = raised;
    void this.send(this.lastPoint);
  }

  /** Resends whatever presence state was last known, bypassing the throttle — called after a reconnect (see `collab-session.ts`'s `onReconnect` wiring) so other peers see this client's current cursor/selection/viewport immediately instead of waiting for the next `updateCursor` call. */
  republish(): void {
    void this.send(this.lastPoint);
  }

  /** Clears locally-tracked state back to "never moved" — called on a full session teardown (`disconnect()`), not on a reconnect (which calls `republish()` instead, to resend what's still valid). */
  reset(): void {
    this.lastPoint = null;
    this.lastSelectedElementIds = [];
    this.lastViewport = null;
    this.lastPageId = null;
    this.pendingReaction = null;
    this.handRaised = false;
  }

  private async send(point: { x: number; y: number } | null): Promise<void> {
    const sendDeps = this.options.getSendDeps();
    // Nothing to send to right now — and crucially, a pending reaction is NOT consumed here: it waits
    // for a send that can actually reach someone rather than being silently thrown away.
    if (!sendDeps) return;
    const reaction = this.pendingReaction;
    this.pendingReaction = null;
    const payload: PresencePayload = {
      name: this.options.userName,
      color: this.options.userColor,
      point,
      selectedElementIds: this.lastSelectedElementIds,
      viewport: this.lastViewport,
      ...(this.lastPageId !== null ? { pageId: this.lastPageId } : {}),
      ...(reaction ? { reaction } : {}),
      ...(this.handRaised ? { handRaised: true } : {}),
    };
    await sendPresenceUpdate(sendDeps, payload);
  }
}

/** Cheap equality so a re-render that recomputes an identical viewport costs no broadcast. */
function sameViewport(a: PresenceViewport | null, b: PresenceViewport | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}
