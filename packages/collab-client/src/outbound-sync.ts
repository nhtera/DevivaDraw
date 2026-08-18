/**
 * Encrypts and sends the local side of a collab session's traffic — element deltas, full snapshots,
 * and presence updates. Pulled out of `collab-session.ts` purely to keep that file's lifecycle/timer
 * bookkeeping readable; the version-diffing strategy that makes `flushElementDeltas` echo-safe is
 * documented on `collab-session.ts` itself (this module just performs the encrypt-and-send step once
 * the caller has already decided *what* changed).
 */
import { encryptEnvelope } from "./message-codec";
import type { CollabPagesAdapter } from "./pages-adapter";
import type { PresencePayload } from "./presence-state";
import type { Scene } from "@deviva-draw/engine";

export interface OutboundSyncDeps {
  scene: Scene;
  roomKey: CryptoKey;
  send(data: string): boolean;
  /** Which page `scene` is, in a multi-page session — tagged onto every delta so receivers route it; absent in single-scene sessions (the wire shape stays exactly what pre-pages peers expect). Also namespaces the `syncedVersions` keys, since the same map spans every page. */
  pageId?: string;
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
    const syncKey = deps.pageId === undefined ? element.id : `${deps.pageId}/${element.id}`;
    if (syncedVersions.get(syncKey) === element.version) continue;
    const versionAtScanTime = element.version;
    const envelope = await encrypt(deps.roomKey, "element-delta", deps.pageId === undefined ? { element } : { element, pageId: deps.pageId });

    const current = deps.scene.getElement(element.id);
    if (!current || current.version !== versionAtScanTime) continue; // stale — superseded during the encrypt window

    syncedVersions.set(syncKey, versionAtScanTime);
    deps.send(JSON.stringify(envelope));
  }
}

/**
 * The comment sibling of `flushElementDeltas`, with the identical version-diffing strategy and the
 * identical stale-after-encrypt guard — a concurrent local edit or an inbound merge can land on a
 * record while this coroutine is suspended mid-encrypt, and sending the superseded frame (or, worse,
 * recording its version as synced) is how a store goes quietly stale.
 *
 * `syncedComments` is a SEPARATE map from the element one, not a prefixed namespace inside it: a
 * comment id and an element id are both opaque strings, and a shared map guarded only by a naming
 * convention is one forgetful edit away from a collision that silently stops syncing an element.
 *
 * Threads and messages are flushed as their own `comment-delta` frames — never batched into one —
 * because per-record deltas are exactly what lets two peers' concurrent replies both survive.
 */
export async function flushCommentDeltas(deps: OutboundSyncDeps, syncedComments: Map<string, number>): Promise<void> {
  const encrypt = deps.encryptEnvelope ?? encryptEnvelope;
  const scene = deps.scene;
  const key = (id: string) => (deps.pageId === undefined ? id : `${deps.pageId}/${id}`);

  for (const thread of scene.getAllCommentThreads()) {
    if (syncedComments.get(key(thread.id)) === thread.version) continue;
    const versionAtScanTime = thread.version;
    const envelope = await encrypt(deps.roomKey, "comment-delta", deps.pageId === undefined ? { thread } : { thread, pageId: deps.pageId });
    const current = scene.getCommentThread(thread.id);
    if (!current || current.version !== versionAtScanTime) continue; // superseded during the encrypt window
    syncedComments.set(key(thread.id), versionAtScanTime);
    deps.send(JSON.stringify(envelope));
  }

  for (const message of scene.getAllCommentMessages()) {
    if (syncedComments.get(key(message.id)) === message.version) continue;
    const versionAtScanTime = message.version;
    const envelope = await encrypt(deps.roomKey, "comment-delta", deps.pageId === undefined ? { message } : { message, pageId: deps.pageId });
    const current = scene.getCommentMessage(message.id);
    if (!current || current.version !== versionAtScanTime) continue;
    syncedComments.set(key(message.id), versionAtScanTime);
    deps.send(JSON.stringify(envelope));
  }
}

/** The comment arrays a snapshot carries for one scene, or `{}` when it has none — an untouched scene adds no keys, so pre-comments peers see exactly the payload they always did. */
function commentsSnapshotFields(scene: Scene): { comments?: unknown[]; commentMessages?: unknown[] } {
  if (!scene.hasComments()) return {};
  return { comments: scene.getAllCommentThreads(), commentMessages: scene.getAllCommentMessages() };
}

/** Sends every current element (including soft-deleted ones) as one `snapshot` message — the full-state recovery path a newly-joined or reconnecting peer's `snapshot-request` resolves against. */
export async function sendFullSnapshot(deps: OutboundSyncDeps): Promise<void> {
  const elements = [...deps.scene.elementsUnsorted()];
  const envelope = await encryptEnvelope(deps.roomKey, "snapshot", { elements, ...commentsSnapshotFields(deps.scene) });
  deps.send(JSON.stringify(envelope));
}

/**
 * The multi-page snapshot: every page's elements plus the page-list manifest, in one message —
 * the same wire `type` as the single-scene snapshot (the relay's whitelist never changes), told
 * apart by shape on the receiving side (`inbound-message-handler.ts`).
 */
export async function sendDocumentSnapshot(deps: Omit<OutboundSyncDeps, "scene" | "pageId">, pages: CollabPagesAdapter): Promise<void> {
  const manifest = pages.getManifest();
  const payload = {
    manifest,
    pages: manifest.pages.map((entry) => {
      const layers = pages.getLayersManifest(entry.id);
      const scene = pages.getScene(entry.id);
      return {
        id: entry.id,
        name: entry.name,
        elements: [...(scene?.elementsUnsorted() ?? [])],
        // Attached inside the per-page entry (never a new wire type) — pre-layers peers ignore the
        // unknown key; `null` (never-mutated) pages send nothing so they can't outrank real state.
        ...(layers !== null ? { layers } : {}),
        // Comments ride the same way, under the same "omit when empty" rule.
        ...(scene ? commentsSnapshotFields(scene) : {}),
      };
    }),
  };
  const envelope = await encryptEnvelope(deps.roomKey, "snapshot", payload);
  deps.send(JSON.stringify(envelope));
}

/** Sends one presence update — uncompressed (see `message-codec.ts`'s `EnvelopeCodecOptions` doc: small, frequent, latency-sensitive). */
export async function sendPresenceUpdate(deps: Omit<OutboundSyncDeps, "scene">, payload: PresencePayload): Promise<void> {
  const envelope = await encryptEnvelope(deps.roomKey, "presence", payload, { compress: false });
  deps.send(JSON.stringify(envelope));
}
