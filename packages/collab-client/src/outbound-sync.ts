/**
 * Encrypts and sends the local side of a collab session's traffic — element deltas, full snapshots,
 * and presence updates. Pulled out of `collab-session.ts` purely to keep that file's lifecycle/timer
 * bookkeeping readable; the version-diffing strategy that makes `flushElementDeltas` echo-safe is
 * documented on `collab-session.ts` itself (this module just performs the encrypt-and-send step once
 * the caller has already decided *what* changed).
 */
import { encryptEnvelope } from "./message-codec";
import type { PresencePayload } from "./presence-state";
import type { Scene } from "@deviva-draw/engine";

export interface OutboundSyncDeps {
  scene: Scene;
  roomKey: CryptoKey;
  send(data: string): boolean;
  /**
   * Encrypts one payload — injectable so tests can control exactly when the `await` gap resolves (used
   * to deterministically simulate a scene mutation racing the encrypt window, see
   * `flushElementDeltas`'s doc). Defaults to `message-codec.ts`'s real `encryptEnvelope`; production
   * callers never set this.
   */
  encryptEnvelope?: typeof encryptEnvelope;
}

/**
 * Scans `scene` for every element whose current `version` doesn't match what's already recorded in
 * `syncedVersions`, sends each as an encrypted `element-delta`, and records the version it just sent —
 * so a later call with the same (unchanged) element is a no-op scan, not a resend.
 *
 * Each element's *current* version is re-read after `encryptEnvelope`'s `await` (encryption is genuinely
 * async — a `crypto.subtle` call, not a synchronous transform) rather than trusting the version captured
 * before it: a concurrent local edit or a remote LWW-merge apply (`Scene.applyRemoteElement`) can land on
 * the same element while this coroutine is suspended mid-encrypt. If the version changed, the
 * just-encrypted frame is now stale — it's dropped (never sent) and, just as importantly, `syncedVersions`
 * is left untouched rather than being marked with a version that's already been superseded, so the next
 * scan correctly picks up whatever the element's true current version is instead of silently going stale
 * itself.
 */
export async function flushElementDeltas(deps: OutboundSyncDeps, syncedVersions: Map<string, number>): Promise<void> {
  const encrypt = deps.encryptEnvelope ?? encryptEnvelope;
  for (const element of deps.scene.elementsUnsorted()) {
    if (syncedVersions.get(element.id) === element.version) continue;
    const versionAtScanTime = element.version;
    const envelope = await encrypt(deps.roomKey, "element-delta", { element });

    const current = deps.scene.getElement(element.id);
    if (!current || current.version !== versionAtScanTime) continue; // stale — superseded during the encrypt window

    syncedVersions.set(element.id, versionAtScanTime);
    deps.send(JSON.stringify(envelope));
  }
}

/** Sends every current element (including soft-deleted ones) as one `snapshot` message — the full-state recovery path a newly-joined or reconnecting peer's `snapshot-request` resolves against. */
export async function sendFullSnapshot(deps: OutboundSyncDeps): Promise<void> {
  const elements = [...deps.scene.elementsUnsorted()];
  const envelope = await encryptEnvelope(deps.roomKey, "snapshot", { elements });
  deps.send(JSON.stringify(envelope));
}

/** Sends one presence update — uncompressed (see `message-codec.ts`'s `EnvelopeCodecOptions` doc: small, frequent, latency-sensitive). */
export async function sendPresenceUpdate(deps: Omit<OutboundSyncDeps, "scene">, payload: PresencePayload): Promise<void> {
  const envelope = await encryptEnvelope(deps.roomKey, "presence", payload, { compress: false });
  deps.send(JSON.stringify(envelope));
}
