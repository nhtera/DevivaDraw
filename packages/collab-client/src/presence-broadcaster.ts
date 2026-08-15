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
import type { PresencePayload, PresenceViewport } from "./presence-state";
import { throttle } from "./presence-state";

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

  setLocalViewport(viewport: PresenceViewport | null): void {
    this.lastViewport = viewport;
  }

  /** Which page the local user is looking at — rides with the next broadcast so peers can keep foreign-page cursors off their canvas. `null` in single-scene sessions (the field is simply absent on the wire). */
  setLocalPage(pageId: string | null): void {
    if (this.lastPageId === pageId) return;
    this.lastPageId = pageId;
    // A page switch should be visible promptly (the peer's cursor must vanish from the old page), so it republishes rather than waiting for the next pointer move.
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
  }

  private async send(point: { x: number; y: number } | null): Promise<void> {
    const sendDeps = this.options.getSendDeps();
    if (!sendDeps) return;
    const payload: PresencePayload = {
      name: this.options.userName,
      color: this.options.userColor,
      point,
      selectedElementIds: this.lastSelectedElementIds,
      viewport: this.lastViewport,
      ...(this.lastPageId !== null ? { pageId: this.lastPageId } : {}),
    };
    await sendPresenceUpdate(sendDeps, payload);
  }
}
