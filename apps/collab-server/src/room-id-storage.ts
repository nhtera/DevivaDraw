/**
 * Persists a Durable Object room's id across hibernation. `RoomDO`'s constructor runs fresh on every
 * wake-from-hibernation — the whole JS object, including plain instance fields, is evicted; only
 * `state.getWebSockets()` and each socket's `serializeAttachment` survive (see
 * `room-durable-object.ts`'s module doc) — so a `roomId` learned only from `fetch()`'s URL would be
 * lost the moment a `webSocketMessage` arrives on a woken-but-not-freshly-`fetch()`'d instance, silently
 * disabling R2 snapshot persistence (`onSnapshotReceived` bails out when `roomId` is unset) for an
 * otherwise-healthy, idle room.
 *
 * Extracted as a small standalone unit (not inlined in `room-durable-object.ts`) so the persist/restore
 * decision is testable with a trivial injected storage fake, matching this Worker's "hermetic logic,
 * thin Workers-specific glue" split used everywhere else in `apps/collab-server`
 * (`room-connection-registry.ts`, `snapshot-persistence.ts`).
 */
const ROOM_ID_STORAGE_KEY = "room-id";

/** The subset of `DurableObjectStorage` this module actually uses. */
export interface RoomIdStorage {
  get(key: string): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

/** Idempotent — safe to call on every `fetch()`, not just the first, since every `fetch()` already knows the room id from its own URL. */
export async function persistRoomId(storage: RoomIdStorage, roomId: string): Promise<void> {
  await storage.put(ROOM_ID_STORAGE_KEY, roomId);
}

/** Returns the previously-persisted room id, or `null` if this DO instance has never handled a `fetch()` yet (a genuinely brand-new room, not just a hibernation wake-up — a wake-up always has a prior `fetch()` behind it, since that's the only way a WebSocket could have been accepted in the first place). Never throws: a corrupted/wrong-shaped stored value is treated the same as "never persisted" rather than crashing DO construction. */
export async function restoreRoomId(storage: RoomIdStorage): Promise<string | null> {
  try {
    const value = await storage.get(ROOM_ID_STORAGE_KEY);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}
