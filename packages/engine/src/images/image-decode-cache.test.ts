import { describe, expect, it, vi } from "vitest";
import { ImageDecodeCache } from "./image-decode-cache";

interface FakeImage {
  width: number;
  height: number;
}

/** Flushes pending microtasks so an already-resolved/rejected `decode()` promise has settled before assertions run. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ImageDecodeCache — get", () => {
  it("returns undefined on first request (decode is in flight) and kicks off exactly one decode call", async () => {
    const decode = vi.fn(() => Promise.resolve<FakeImage>({ width: 10, height: 5 }));
    const cache = new ImageDecodeCache(decode);

    const result = cache.get("file-1", "data:image/png;base64,AAA");

    expect(result).toBeUndefined();
    expect(decode).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledWith("data:image/png;base64,AAA");
  });

  it("returns the decoded image once the decode settles", async () => {
    const decode = () => Promise.resolve<FakeImage>({ width: 10, height: 5 });
    const cache = new ImageDecodeCache(decode);

    cache.get("file-1", "data:image/png;base64,AAA");
    await flushMicrotasks();

    expect(cache.get("file-1", "data:image/png;base64,AAA")).toEqual({ width: 10, height: 5 });
    expect(cache.status("file-1")).toBe("loaded");
  });

  it("caches by fileId, not by call site: a second request for the same fileId never re-decodes", async () => {
    const decode = vi.fn(() => Promise.resolve<FakeImage>({ width: 10, height: 5 }));
    const cache = new ImageDecodeCache(decode);

    cache.get("shared-file", "data:image/png;base64,AAA");
    await flushMicrotasks();
    cache.get("shared-file", "data:image/png;base64,AAA");
    cache.get("shared-file", "data:image/png;base64,AAA");

    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("two different elements referencing the same fileId share one decoded bitmap", async () => {
    const decode = vi.fn(() => Promise.resolve<FakeImage>({ width: 20, height: 20 }));
    const cache = new ImageDecodeCache(decode);

    // Simulates element A's render call, then element B's render call for the same file.
    cache.get("shared-file", "data:image/png;base64,AAA");
    await flushMicrotasks();
    const forElementA = cache.get("shared-file", "data:image/png;base64,AAA");
    const forElementB = cache.get("shared-file", "data:image/png;base64,AAA");

    expect(decode).toHaveBeenCalledTimes(1);
    expect(forElementA).toBe(forElementB); // same cached object reference
  });

  it("decodes independently per distinct fileId", async () => {
    const decode = vi.fn((dataURL: string) => Promise.resolve<FakeImage>({ width: dataURL.length, height: 1 }));
    const cache = new ImageDecodeCache(decode);

    cache.get("file-a", "aaa");
    cache.get("file-b", "bbbbb");
    await flushMicrotasks();

    expect(decode).toHaveBeenCalledTimes(2);
    expect(cache.get("file-a", "aaa")).toEqual({ width: 3, height: 1 });
    expect(cache.get("file-b", "bbbbb")).toEqual({ width: 5, height: 1 });
  });

  it("status() reflects error after a rejected decode, and get() stays undefined", async () => {
    const decode = () => Promise.reject<FakeImage>(new Error("decode failed"));
    const cache = new ImageDecodeCache(decode);

    cache.get("file-1", "bad-data-url");
    await flushMicrotasks();

    expect(cache.status("file-1")).toBe("error");
    expect(cache.get("file-1", "bad-data-url")).toBeUndefined();
  });

  it("status() is 'unrequested' before any get() call for that fileId", () => {
    const cache = new ImageDecodeCache(() => Promise.resolve<FakeImage>({ width: 1, height: 1 }));
    expect(cache.status("never-requested")).toBe("unrequested");
  });

  it("calls onSettled with the fileId once the decode resolves", async () => {
    const onSettled = vi.fn();
    const cache = new ImageDecodeCache(() => Promise.resolve<FakeImage>({ width: 1, height: 1 }), onSettled);

    cache.get("file-1", "data-url");
    await flushMicrotasks();

    expect(onSettled).toHaveBeenCalledWith("file-1");
  });

  it("calls onSettled even when the decode rejects", async () => {
    const onSettled = vi.fn();
    const cache = new ImageDecodeCache(() => Promise.reject<FakeImage>(new Error("nope")), onSettled);

    cache.get("file-1", "data-url");
    await flushMicrotasks();

    expect(onSettled).toHaveBeenCalledWith("file-1");
  });
});

describe("ImageDecodeCache — prune", () => {
  it("drops entries for fileIds not in the live set", async () => {
    const cache = new ImageDecodeCache(() => Promise.resolve<FakeImage>({ width: 1, height: 1 }));
    cache.get("kept", "a");
    cache.get("dropped", "b");
    await flushMicrotasks();

    cache.prune(new Set(["kept"]));

    expect(cache.size).toBe(1);
    expect(cache.status("dropped")).toBe("unrequested");
  });

  it("does not unboundedly grow across repeated request-then-prune cycles", async () => {
    const cache = new ImageDecodeCache(() => Promise.resolve<FakeImage>({ width: 1, height: 1 }));
    for (let i = 0; i < 20; i += 1) {
      cache.get(`file-${i}`, "a");
      cache.prune(new Set());
    }
    expect(cache.size).toBe(0);
  });
});
