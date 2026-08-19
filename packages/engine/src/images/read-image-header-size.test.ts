/**
 * Fixtures are hand-built headers rather than real image files: the point is to pin the byte
 * arithmetic, and a real photo would prove only that one encoder's output parses. Hostile input gets
 * its own block — this module's entire contract with a malicious file is "never throws, never reads
 * past the buffer", so that is tested directly rather than assumed.
 */
import { describe, expect, it } from "vitest";
import { readImageHeaderSize } from "./read-image-header-size";

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function jpegHeader(width: number, height: number, precedingSegmentLength = 16): Uint8Array {
  // SOI, one APPn segment of the given length (the EXIF block a real camera writes), then SOF0.
  const bytes = new Uint8Array(4 + precedingSegmentLength + 11);
  const view = new DataView(bytes.buffer);
  bytes.set([0xff, 0xd8, 0xff, 0xe1]); // SOI + APP1 marker
  view.setUint16(4, precedingSegmentLength);
  const offset = 4 + precedingSegmentLength;
  bytes.set([0xff, 0xc0], offset); // SOF0
  view.setUint16(offset + 2, 11); // segment length
  bytes[offset + 4] = 8; // sample precision
  view.setUint16(offset + 5, height);
  view.setUint16(offset + 7, width);
  return bytes;
}

function gifHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(13);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
  new DataView(bytes.buffer).setUint16(6, width, true);
  new DataView(bytes.buffer).setUint16(8, height, true);
  return bytes;
}

function webpLossyHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46]); // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  bytes.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
  new DataView(bytes.buffer).setUint16(26, width, true);
  new DataView(bytes.buffer).setUint16(28, height, true);
  return bytes;
}

function webpExtendedHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46]);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  const canvasWidth = width - 1;
  const canvasHeight = height - 1;
  bytes.set([canvasWidth & 0xff, (canvasWidth >> 8) & 0xff, (canvasWidth >> 16) & 0xff], 24);
  bytes.set([canvasHeight & 0xff, (canvasHeight >> 8) & 0xff, (canvasHeight >> 16) & 0xff], 27);
  return bytes;
}

describe("readImageHeaderSize", () => {
  it("reads PNG dimensions from the IHDR chunk", () => {
    expect(readImageHeaderSize(pngHeader(1920, 1080))).toEqual({ format: "png", width: 1920, height: 1080 });
  });

  it("reads a decompression bomb's declared PNG size without needing the pixel data", () => {
    // The whole point: a header this size fits in 24 bytes, while decoding it would allocate ~3.6 TB.
    expect(readImageHeaderSize(pngHeader(30000, 30000))).toEqual({ format: "png", width: 30000, height: 30000 });
  });

  it("walks JPEG segments to the frame header rather than assuming a fixed offset", () => {
    expect(readImageHeaderSize(jpegHeader(4032, 3024))).toEqual({ format: "jpeg", width: 4032, height: 3024 });
    // A camera's EXIF block is far bigger than the toy one above; the walk must survive it.
    expect(readImageHeaderSize(jpegHeader(800, 600, 2048))).toEqual({ format: "jpeg", width: 800, height: 600 });
  });

  it("reads GIF's little-endian logical screen descriptor", () => {
    expect(readImageHeaderSize(gifHeader(320, 240))).toEqual({ format: "gif", width: 320, height: 240 });
  });

  it("reads both the lossy and extended WebP layouts", () => {
    expect(readImageHeaderSize(webpLossyHeader(640, 480))).toEqual({ format: "webp", width: 640, height: 480 });
    expect(readImageHeaderSize(webpExtendedHeader(1024, 768))).toEqual({ format: "webp", width: 1024, height: 768 });
  });

  it("sniffs the format from the bytes, so a mislabelled file cannot dodge the check", () => {
    // No mime type is passed at all — that is the design. A PNG called `photo.avif` still reads as PNG.
    expect(readImageHeaderSize(pngHeader(9000, 9000))?.format).toBe("png");
  });

  it("returns null for a format it cannot read, rather than guessing", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>');
    expect(readImageHeaderSize(svg)).toBeNull();
    expect(readImageHeaderSize(new Uint8Array([0x42, 0x4d, 0x36, 0x00]))).toBeNull(); // BMP
  });

  describe("hostile input", () => {
    const fixtures = [pngHeader(100, 100), jpegHeader(100, 100), gifHeader(100, 100), webpLossyHeader(100, 100), webpExtendedHeader(100, 100)];

    it("never throws on a truncation at any length of any supported header", () => {
      for (const fixture of fixtures) {
        for (let length = 0; length <= fixture.length; length += 1) {
          expect(() => readImageHeaderSize(fixture.subarray(0, length))).not.toThrow();
        }
      }
    });

    it("never throws on garbage, empty input, or a JPEG whose segment lengths lie", () => {
      expect(() => readImageHeaderSize(new Uint8Array(0))).not.toThrow();
      expect(readImageHeaderSize(new Uint8Array(0))).toBeNull();

      const garbage = new Uint8Array(512);
      for (let index = 0; index < garbage.length; index += 1) garbage[index] = (index * 37) % 256;
      expect(() => readImageHeaderSize(garbage)).not.toThrow();

      // A JPEG claiming a segment that runs off the end of the buffer.
      const lyingJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x00, 0x00]);
      expect(readImageHeaderSize(lyingJpeg)).toBeNull();

      // A JPEG of nothing but marker padding — the segment walk must terminate, not spin.
      const paddingOnly = new Uint8Array(4096).fill(0xff);
      paddingOnly[0] = 0xff;
      paddingOnly[1] = 0xd8;
      paddingOnly[2] = 0xff;
      expect(() => readImageHeaderSize(paddingOnly)).not.toThrow();
    });

    it("reports a zero-length segment chain as unreadable instead of looping forever", () => {
      // 0xFF 0x00 is a stuffed byte, not a marker; a chain of them must not be walked indefinitely.
      const stuffed = new Uint8Array(2048);
      stuffed.set([0xff, 0xd8, 0xff]);
      for (let index = 3; index < stuffed.length; index += 2) {
        stuffed[index] = 0xe0;
        stuffed[index + 1] = 0x00;
      }
      expect(readImageHeaderSize(stuffed)).toBeNull();
    });
  });
});
