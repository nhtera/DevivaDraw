/**
 * Minimal hand-rolled PNG chunk reader/writer — just enough of the PNG container format (signature +
 * length-prefixed, CRC32-checked chunks) to insert/read back a `tEXt` metadata chunk, without pulling
 * in an image-manipulation dependency for what's fundamentally ~80 lines of byte math. Used by
 * `export-to-png.ts` to embed the live scene JSON into an exported PNG (so a previously-exported PNG
 * can later be re-opened as an editable scene) and to read it back out. `tEXt`'s payload is Latin-1
 * only per the PNG spec — `export-to-png.ts` base64-encodes the (UTF-8) scene JSON before calling
 * `writeTextChunk` so arbitrary Unicode text content survives the round trip; this module itself
 * only ever validates/handles Latin-1 bytes and knows nothing about base64 or JSON.
 */

import { crc32 } from "./crc32";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function writeUint32BE(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function assertPngSignature(bytes: Uint8Array): void {
  const hasSignature = bytes.length >= 8 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
  if (!hasSignature) throw new Error("png-chunk-writer: not a PNG file (bad signature)");
}

/** Encodes `text` as Latin-1 bytes, throwing if any character is outside the `0-255` code-point range — the PNG `tEXt` chunk's own encoding constraint. */
function encodeLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 0xff) throw new RangeError(`png-chunk-writer: chunk text must be Latin-1 (byte <= 255); found code point ${code} at index ${i}`);
    bytes[i] = code;
  }
  return bytes;
}

function decodeLatin1(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = encodeLatin1(type);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);

  const chunk = new Uint8Array(4 + typeBytes.length + data.length + 4);
  chunk.set(writeUint32BE(data.length), 0);
  chunk.set(typeBytes, 4);
  chunk.set(data, 4 + typeBytes.length);
  chunk.set(writeUint32BE(crc32(crcInput)), 4 + typeBytes.length + data.length);
  return chunk;
}

/** The byte offset one past the end of the first chunk after the 8-byte signature — PNG requires `IHDR` to be exactly this first chunk. */
function endOfFirstChunk(bytes: Uint8Array): { type: string; end: number } {
  const length = readUint32BE(bytes, 8);
  const type = decodeLatin1(bytes.slice(12, 16));
  return { type, end: 16 + length + 4 };
}

/**
 * Inserts a `tEXt` chunk (`keyword`\0`text`) right after the PNG's `IHDR` chunk — before any pixel
 * data, so a later `readTextChunk` never has to scan past image data to find it. Returns a new byte
 * array; `pngBytes` is never mutated in place. Throws if `pngBytes` isn't a well-formed PNG (bad
 * signature, or a first chunk that isn't `IHDR`) or if `keyword`/`text` contain a non-Latin-1 character.
 */
export function writeTextChunk(pngBytes: Uint8Array, keyword: string, text: string): Uint8Array {
  assertPngSignature(pngBytes);
  const first = endOfFirstChunk(pngBytes);
  if (first.type !== "IHDR") throw new Error(`png-chunk-writer: expected IHDR as the first chunk, found "${first.type}"`);

  const keywordBytes = encodeLatin1(keyword);
  const textBytes = encodeLatin1(text);
  const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
  data.set(keywordBytes, 0);
  data[keywordBytes.length] = 0;
  data.set(textBytes, keywordBytes.length + 1);
  const chunk = buildChunk("tEXt", data);

  const result = new Uint8Array(pngBytes.length + chunk.length);
  result.set(pngBytes.slice(0, first.end), 0);
  result.set(chunk, first.end);
  result.set(pngBytes.slice(first.end), first.end + chunk.length);
  return result;
}

/**
 * Reads back a `tEXt` chunk written by `writeTextChunk` for `keyword`, or `null` if this PNG has no
 * such chunk (not a devivadraw-exported PNG, embedding was disabled, or a plain re-export). Never
 * throws on a malformed/truncated PNG — returns `null` instead, since embedded scene data is a
 * nice-to-have re-import convenience, not required for the PNG itself to be valid/openable.
 */
export function readTextChunk(pngBytes: Uint8Array, keyword: string): string | null {
  try {
    assertPngSignature(pngBytes);
    let offset = 8;
    while (offset + 8 <= pngBytes.length) {
      const length = readUint32BE(pngBytes, offset);
      const type = decodeLatin1(pngBytes.slice(offset + 4, offset + 8));
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > pngBytes.length) return null;

      if (type === "tEXt") {
        const data = pngBytes.slice(dataStart, dataEnd);
        const nullIndex = data.indexOf(0);
        if (nullIndex !== -1 && decodeLatin1(data.slice(0, nullIndex)) === keyword) {
          return decodeLatin1(data.slice(nullIndex + 1));
        }
      }
      if (type === "IEND") return null;
      offset = dataEnd + 4;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The image's pixel dimensions, read out of the `IHDR` chunk (always the first chunk, immediately
 * after the signature). Returns `null` for anything that is not a PNG or is truncated before its
 * header — the same never-throw contract `readTextChunk` follows.
 *
 * Exists so a caller can learn what it is actually about to place without decoding the image: the
 * slide exporter needs the true rendered size, not the nominal size it asked for, and creating an
 * `Image` to find that out would drag a DOM dependency into a path that has none.
 */
export function readPngPixelSize(pngBytes: Uint8Array): { width: number; height: number } | null {
  try {
    assertPngSignature(pngBytes);
  } catch {
    return null;
  }
  // 8 signature bytes + 4 length + 4 type ⇒ IHDR data starts at 16, width then height as uint32 BE.
  if (pngBytes.length < 24) return null;
  const width = readUint32BE(pngBytes, 16);
  const height = readUint32BE(pngBytes, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}
