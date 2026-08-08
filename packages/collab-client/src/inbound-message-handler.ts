/**
 * Parses and dispatches a single inbound WebSocket frame for `collab-session.ts` — pulled into its own
 * module so the "untrusted wire data in, validated effect on `Scene`/presence out" dispatch logic is
 * unit-testable in isolation from `CollabSession`'s connection/timer lifecycle. Every branch here treats
 * `raw` as fully attacker-controlled: a malformed JSON frame, an unrecognized `type`, ciphertext that
 * fails to decrypt, or a payload shape that doesn't match its `type` are all silently ignored rather
 * than thrown — a single hostile or buggy peer must never crash another peer's session.
 */
import { decryptEnvelope } from "./message-codec";
import type { RoomEnvelope } from "./message-codec";
import { mergeRemoteElement } from "./lww-merge";
import type { Scene } from "@deviva-draw/engine";
import type { PresenceStore } from "./presence-state";

export interface InboundMessageDeps {
  scene: Scene;
  presence: PresenceStore;
  roomKey: CryptoKey;
  /** Records that element `id` is now synced at `version` — prevents the next outbound scan from redundantly re-sending an element this session just received. */
  markSynced(id: string, version: number): void;
  onPeerLeft(peerId: string): void;
  /**
   * Fires when the *relay* forwards a `snapshot-request` to this peer — meaning the Durable Object had
   * no stored snapshot yet to answer a newcomer/reconnecting peer directly (see
   * `apps/collab-server/src/room-connection-registry.ts`'s fast-path-vs-broadcast doc) and is asking
   * any already-connected peer to publish one. The handler responds by sending a fresh snapshot
   * immediately rather than waiting for the periodic timer, so a brand-new room member sees existing
   * state promptly instead of only catching whatever element-deltas happen to arrive after they joined.
   */
  onSnapshotRequested(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function applyElementPayload(payload: unknown, deps: InboundMessageDeps): Promise<void> {
  if (!isRecord(payload)) return;
  const element = payload.element;
  if (mergeRemoteElement(deps.scene, element)) {
    // Safe: `mergeRemoteElement` only returns `true` after its own runtime structural validation.
    const applied = element as { id: string; version: number };
    deps.markSynced(applied.id, applied.version);
  }
}

async function applySnapshotPayload(payload: unknown, deps: InboundMessageDeps): Promise<void> {
  if (!isRecord(payload) || !Array.isArray(payload.elements)) return;
  for (const element of payload.elements) {
    if (mergeRemoteElement(deps.scene, element)) {
      const applied = element as { id: string; version: number };
      deps.markSynced(applied.id, applied.version);
    }
  }
}

/** Entry point: parse `raw`, route by `type`, decrypt+apply. Never throws — every failure path is a silent no-op by design (see module doc). */
export async function handleInboundMessage(raw: string, deps: InboundMessageDeps): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string") return;

  if (parsed.type === "peer-left") {
    if (typeof parsed.peerId === "string") deps.onPeerLeft(parsed.peerId);
    return;
  }
  if (parsed.type === "peer-joined") return; // purely informational; nothing to apply
  if (parsed.type === "snapshot-request") {
    deps.onSnapshotRequested();
    return;
  }

  const envelope = parsed as unknown as RoomEnvelope & { peerId?: unknown };
  if (envelope.type === "element-delta") {
    const decrypted = await decryptEnvelope(deps.roomKey, envelope);
    if (decrypted.ok) await applyElementPayload(decrypted.payload, deps);
    return;
  }
  if (envelope.type === "snapshot") {
    const decrypted = await decryptEnvelope(deps.roomKey, envelope);
    if (decrypted.ok) await applySnapshotPayload(decrypted.payload, deps);
    return;
  }
  if (envelope.type === "presence" && typeof envelope.peerId === "string") {
    const decrypted = await decryptEnvelope(deps.roomKey, envelope, { compress: false });
    if (decrypted.ok) deps.presence.applyUpdate(envelope.peerId, decrypted.payload);
  }
}
