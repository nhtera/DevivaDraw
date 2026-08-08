import { describe, expect, it } from "vitest";
import { bytesToDataURL, computeFileId, FilesMap } from "./files-map";

function bytesFrom(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("computeFileId", () => {
  it("is deterministic: identical bytes always hash to the same id", async () => {
    const a = await computeFileId(bytesFrom("hello world"));
    const b = await computeFileId(bytesFrom("hello world"));
    expect(a).toBe(b);
  });

  it("produces different ids for different content — dedup only reuses truly identical pastes", async () => {
    const a = await computeFileId(bytesFrom("image-bytes-a"));
    const b = await computeFileId(bytesFrom("image-bytes-b"));
    expect(a).not.toBe(b);
  });

  it("returns a non-empty hex-ish string", async () => {
    const id = await computeFileId(bytesFrom("x"));
    expect(id.length).toBeGreaterThan(0);
    expect(id).toMatch(/^[0-9a-f]+$/);
  });
});

describe("bytesToDataURL", () => {
  it("wraps base64-encoded bytes with the mime type prefix", () => {
    const dataURL = bytesToDataURL(bytesFrom("hi"), "image/png");
    expect(dataURL.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("round-trips through atob back to the original bytes", () => {
    const original = "the quick brown fox jumps over the lazy dog";
    const dataURL = bytesToDataURL(bytesFrom(original), "text/plain");
    const base64 = dataURL.split(",")[1]!;
    expect(atob(base64)).toBe(original);
  });

  it("handles a byte array larger than one base64-encode chunk without corrupting the output", () => {
    const large = new Uint8Array(100_000).map((_, index) => index % 256);
    const dataURL = bytesToDataURL(large, "application/octet-stream");
    const base64 = dataURL.split(",")[1]!;
    const decoded = atob(base64);
    expect(decoded.length).toBe(large.length);
    expect(decoded.charCodeAt(0)).toBe(0);
    expect(decoded.charCodeAt(99_999)).toBe(99_999 % 256);
  });
});

describe("FilesMap", () => {
  it("starts empty", () => {
    const files = new FilesMap();
    expect(files.size).toBe(0);
    expect(files.has("f1")).toBe(false);
    expect(files.get("f1")).toBeUndefined();
  });

  it("set stores a file and get/has retrieve it", () => {
    const files = new FilesMap();
    const stored = { mimeType: "image/png", dataURL: "data:image/png;base64,AAA", createdAt: 1 };

    const inserted = files.set("f1", stored);

    expect(inserted).toBe(true);
    expect(files.has("f1")).toBe(true);
    expect(files.get("f1")).toEqual(stored);
    expect(files.size).toBe(1);
  });

  it("set is a dedup no-op for an id that already exists — the existing entry is left untouched", () => {
    const files = new FilesMap();
    const original = { mimeType: "image/png", dataURL: "data:image/png;base64,AAA", createdAt: 1 };
    const attempted = { mimeType: "image/png", dataURL: "data:image/png;base64,BBB", createdAt: 2 };

    files.set("f1", original);
    const inserted = files.set("f1", attempted);

    expect(inserted).toBe(false);
    expect(files.get("f1")).toEqual(original);
    expect(files.size).toBe(1);
  });

  it("keys() enumerates every stored fileId", () => {
    const files = new FilesMap();
    files.set("f1", { mimeType: "image/png", dataURL: "d1", createdAt: 1 });
    files.set("f2", { mimeType: "image/png", dataURL: "d2", createdAt: 2 });
    expect([...files.keys()].sort()).toEqual(["f1", "f2"]);
  });

  describe("pruneOrphaned", () => {
    it("removes files whose id is not in the live-id set, keeps the rest", () => {
      const files = new FilesMap();
      files.set("kept", { mimeType: "image/png", dataURL: "d1", createdAt: 1 });
      files.set("dropped", { mimeType: "image/png", dataURL: "d2", createdAt: 2 });

      const removed = files.pruneOrphaned(new Set(["kept"]));

      expect(removed).toEqual(["dropped"]);
      expect(files.has("kept")).toBe(true);
      expect(files.has("dropped")).toBe(false);
      expect(files.size).toBe(1);
    });

    it("removes nothing when every stored file is still live", () => {
      const files = new FilesMap();
      files.set("f1", { mimeType: "image/png", dataURL: "d1", createdAt: 1 });

      const removed = files.pruneOrphaned(new Set(["f1"]));

      expect(removed).toEqual([]);
      expect(files.size).toBe(1);
    });
  });
});
