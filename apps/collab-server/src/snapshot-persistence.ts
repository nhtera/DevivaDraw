/**
 * R2-backed durability for a room's latest encrypted snapshot — bounds how much history is lost if a
 * Durable Object is evicted mid-session or every client disconnects before a new one joins: on cold
 * start, `room-durable-object.ts` calls `loadPersistedSnapshot` to reseed `RoomConnectionRegistry`'s
 * in-memory cache; on every `snapshot` message the registry sees, it calls `persistSnapshot` (via
 * `ctx.waitUntil`, fire-and-forget) so the bound is "at most one snapshot interval old", not "lost
 * entirely". The stored value is the exact JSON string the registry already relays — this module never
 * parses, decrypts, or otherwise understands it; it's a dumb key-value write/read, same trust boundary
 * as `blob-routes.ts`'s share-link blobs.
 */

/** The subset of Cloudflare's real `R2Bucket` interface this module uses — hand-written (not imported from `@cloudflare/workers-types` directly) so tests can inject a trivial in-memory fake, mirroring `blob-routes.ts`'s `BlobStore`. */
export interface SnapshotBucket {
  put(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

function snapshotKey(roomId: string): string {
  return `rooms/${roomId}/snapshot.json`;
}

/** Best-effort write — callers wrap this in `ctx.waitUntil` and never await it inline on the message-handling hot path, since losing a single persistence write only widens the recovery-staleness bound by one interval, not a correctness failure. */
export async function persistSnapshot(bucket: SnapshotBucket, roomId: string, snapshotJson: string): Promise<void> {
  await bucket.put(snapshotKey(roomId), snapshotJson);
}

/** Reads back the last-persisted snapshot for `roomId`, or `null` if the room has never had one persisted (a brand-new room, or one whose only activity so far was presence/no completed snapshot cycle). Never throws — a transient R2 read failure just means the DO starts with an empty cache, the same state a genuinely brand-new room would have. */
export async function loadPersistedSnapshot(bucket: SnapshotBucket, roomId: string): Promise<string | null> {
  try {
    const object = await bucket.get(snapshotKey(roomId));
    return object ? await object.text() : null;
  } catch {
    return null;
  }
}
