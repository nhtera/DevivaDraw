import { describe, expect, it } from "vitest";
import { loadPersistedSnapshot, persistSnapshot } from "./snapshot-persistence";
import type { SnapshotBucket } from "./snapshot-persistence";

function fakeBucket(): SnapshotBucket & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async put(key, value) {
      data.set(key, value);
      return {};
    },
    async get(key) {
      const value = data.get(key);
      return value === undefined ? null : { text: async () => value };
    },
  };
}

describe("persistSnapshot / loadPersistedSnapshot", () => {
  it("round trips a snapshot for a room", async () => {
    const bucket = fakeBucket();
    await persistSnapshot(bucket, "room-1", '{"type":"snapshot"}');
    expect(await loadPersistedSnapshot(bucket, "room-1")).toBe('{"type":"snapshot"}');
  });

  it("returns null for a room that has never had a snapshot persisted", async () => {
    const bucket = fakeBucket();
    expect(await loadPersistedSnapshot(bucket, "never-seen")).toBeNull();
  });

  it("keeps different rooms' snapshots isolated under distinct keys", async () => {
    const bucket = fakeBucket();
    await persistSnapshot(bucket, "room-a", "a-data");
    await persistSnapshot(bucket, "room-b", "b-data");
    expect(await loadPersistedSnapshot(bucket, "room-a")).toBe("a-data");
    expect(await loadPersistedSnapshot(bucket, "room-b")).toBe("b-data");
  });

  it("a later persistSnapshot overwrites the previous value for the same room", async () => {
    const bucket = fakeBucket();
    await persistSnapshot(bucket, "room-1", "first");
    await persistSnapshot(bucket, "room-1", "second");
    expect(await loadPersistedSnapshot(bucket, "room-1")).toBe("second");
  });

  it("fails closed (returns null) rather than throwing when the bucket read errors", async () => {
    const bucket: SnapshotBucket = {
      async put() {
        return {};
      },
      async get() {
        throw new Error("R2 unavailable");
      },
    };
    await expect(loadPersistedSnapshot(bucket, "room-1")).resolves.toBeNull();
  });
});
