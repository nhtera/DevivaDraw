import { describe, expect, it } from "vitest";
import { gzipCompress, gzipDecompress } from "./gzip-codec";

describe("gzipCompress / gzipDecompress", () => {
  it("round-trips arbitrary text bytes", async () => {
    const original = new TextEncoder().encode(JSON.stringify({ hello: "world", n: 42, list: [1, 2, 3] }));
    const compressed = await gzipCompress(original);
    const decompressed = await gzipDecompress(compressed);
    expect(decompressed).toEqual(original);
  });

  it("round-trips an empty payload", async () => {
    const original = new Uint8Array();
    const decompressed = await gzipDecompress(await gzipCompress(original));
    expect(decompressed).toEqual(original);
  });

  it("actually shrinks a repetitive, compressible payload", async () => {
    const original = new TextEncoder().encode("scene-element-".repeat(500));
    const compressed = await gzipCompress(original);
    expect(compressed.byteLength).toBeLessThan(original.byteLength);
  });
});
