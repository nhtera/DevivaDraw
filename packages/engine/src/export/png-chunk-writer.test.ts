import { describe, expect, it } from "vitest";
import { readTextChunk, writeTextChunk } from "./png-chunk-writer";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function asciiBytes(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

/** A structurally well-formed but minimal PNG: signature + IHDR (13-byte payload, dummy CRC) + IDAT (empty payload) + IEND. `readTextChunk`/`writeTextChunk` never validate CRCs on chunks they didn't write, so placeholder zero CRCs here are fine. */
function fixturePng(): Uint8Array {
  const ihdrData = [...u32be(1), ...u32be(1), 8, 6, 0, 0, 0]; // 1x1, 8-bit, RGBA
  const ihdrChunk = [...u32be(ihdrData.length), ...asciiBytes("IHDR"), ...ihdrData, ...u32be(0)];
  const idatChunk = [...u32be(0), ...asciiBytes("IDAT"), ...u32be(0)];
  const iendChunk = [...u32be(0), ...asciiBytes("IEND"), ...u32be(0)];
  return new Uint8Array([...SIGNATURE, ...ihdrChunk, ...idatChunk, ...iendChunk]);
}

describe("writeTextChunk / readTextChunk round trip", () => {
  it("writes a tEXt chunk and reads the same text back for the same keyword", () => {
    const png = fixturePng();
    const withChunk = writeTextChunk(png, "devivadraw", "hello world");
    expect(readTextChunk(withChunk, "devivadraw")).toBe("hello world");
  });

  it("does not mutate the input byte array", () => {
    const png = fixturePng();
    const original = png.slice();
    writeTextChunk(png, "devivadraw", "payload");
    expect(png).toEqual(original);
  });

  it("inserts the chunk immediately after IHDR, before IDAT", () => {
    const png = fixturePng();
    const withChunk = writeTextChunk(png, "kw", "v");
    // IHDR occupies bytes [8, 33) — 8-byte signature, then 4 (length) + 4 (type) + 13 (data) + 4
    // (crc) = 25 bytes. The new chunk's own 4-byte length field starts right at byte 33.
    const typeBytes = withChunk.slice(33 + 4, 33 + 8);
    expect(String.fromCharCode(...typeBytes)).toBe("tEXt");
  });

  it("readTextChunk returns null for a keyword that was never written", () => {
    const png = fixturePng();
    const withChunk = writeTextChunk(png, "devivadraw", "payload");
    expect(readTextChunk(withChunk, "some-other-keyword")).toBeNull();
  });

  it("readTextChunk returns null when the PNG has no tEXt chunk at all", () => {
    expect(readTextChunk(fixturePng(), "devivadraw")).toBeNull();
  });

  it("round-trips an empty string payload", () => {
    const png = fixturePng();
    const withChunk = writeTextChunk(png, "devivadraw", "");
    expect(readTextChunk(withChunk, "devivadraw")).toBe("");
  });

  it("round-trips a long (multi-kilobyte) payload, e.g. a base64-encoded scene JSON", () => {
    const longText = "AB".repeat(10_000);
    const png = fixturePng();
    const withChunk = writeTextChunk(png, "devivadraw", longText);
    expect(readTextChunk(withChunk, "devivadraw")).toBe(longText);
  });
});

describe("writeTextChunk error handling", () => {
  it("throws for a byte array that doesn't start with the PNG signature", () => {
    const notPng = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(() => writeTextChunk(notPng, "kw", "v")).toThrow(/bad signature/);
  });

  it("throws when the first chunk after the signature isn't IHDR", () => {
    const badFirstChunk = new Uint8Array([...SIGNATURE, ...u32be(0), ...asciiBytes("IDAT"), ...u32be(0)]);
    expect(() => writeTextChunk(badFirstChunk, "kw", "v")).toThrow(/expected IHDR/);
  });

  it("throws RangeError for non-Latin-1 keyword/text content", () => {
    const png = fixturePng();
    expect(() => writeTextChunk(png, "kw", "emoji: \u{1F600}")).toThrow(RangeError);
  });
});

describe("readTextChunk fail-safe behavior on malformed input", () => {
  it("returns null (never throws) for a truncated/corrupt byte array", () => {
    const truncated = new Uint8Array([...SIGNATURE, 0, 0, 0, 13]); // length prefix with no chunk body following
    expect(readTextChunk(truncated, "devivadraw")).toBeNull();
  });

  it("returns null for a byte array that isn't a PNG at all", () => {
    expect(readTextChunk(new Uint8Array([1, 2, 3]), "devivadraw")).toBeNull();
  });

  it("returns null for an empty byte array", () => {
    expect(readTextChunk(new Uint8Array(0), "devivadraw")).toBeNull();
  });
});
