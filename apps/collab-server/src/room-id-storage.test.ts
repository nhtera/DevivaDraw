import { describe, expect, it } from "vitest";
import { persistRoomId, restoreRoomId } from "./room-id-storage";
import type { RoomIdStorage } from "./room-id-storage";

function fakeStorage(): RoomIdStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key) {
      return data.has(key) ? data.get(key) : undefined;
    },
    async put(key, value) {
      data.set(key, value);
    },
  };
}

describe("persistRoomId / restoreRoomId", () => {
  it("round trips a room id", async () => {
    const storage = fakeStorage();
    await persistRoomId(storage, "room-123");
    expect(await restoreRoomId(storage)).toBe("room-123");
  });

  it("returns null when nothing has ever been persisted (a genuinely fresh DO)", async () => {
    expect(await restoreRoomId(fakeStorage())).toBeNull();
  });

  it("is idempotent — calling persistRoomId again with the same id is a harmless no-op", async () => {
    const storage = fakeStorage();
    await persistRoomId(storage, "room-123");
    await persistRoomId(storage, "room-123");
    expect(await restoreRoomId(storage)).toBe("room-123");
  });

  it("a later persistRoomId overwrites the previous value (room id must never silently change though — this only guards the storage layer's own overwrite semantics)", async () => {
    const storage = fakeStorage();
    await persistRoomId(storage, "room-a");
    await persistRoomId(storage, "room-b");
    expect(await restoreRoomId(storage)).toBe("room-b");
  });

  it("treats a corrupted/wrong-typed stored value as 'never persisted' rather than throwing", async () => {
    const storage = fakeStorage();
    storage.data.set("room-id", 12345);
    expect(await restoreRoomId(storage)).toBeNull();
  });

  it("fails closed (returns null) rather than throwing when the storage read itself errors", async () => {
    const storage: RoomIdStorage = {
      async get() {
        throw new Error("storage unavailable");
      },
      async put() {},
    };
    await expect(restoreRoomId(storage)).resolves.toBeNull();
  });
});
