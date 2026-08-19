/**
 * Reads an image's pixel dimensions out of its own header bytes, without decoding it.
 *
 * This exists to close a real hole: `insertImageFile` used to check only the byte length, then hand
 * the file to `decodeNaturalSize`, which materialises the full bitmap. A byte ceiling is not a
 * decode-time memory mitigation — a few hundred KB of maximally-compressed PNG can declare a
 * multi-gigapixel canvas, and by the time any pixel check ran the buffer had already been allocated.
 * Reading the declared dimensions first means an absurd image is refused before anything decodes it.
 *
 * The format is sniffed from the bytes, **not** from the caller's mime type. A mislabelled file is
 * exactly what an attacker would send, and browsers sniff image content anyway, so trusting the
 * declared type would make the check bypassable by renaming. Formats this cannot read return `null`,
 * which callers must treat as "unknown", not as "safe" or "unsafe" — the decision about what to do
 * with an unreadable header belongs to the caller's policy, not here.
 *
 * **Known coverage gap.** PNG, JPEG, GIF and WebP are read; AVIF and HEIC are not, and both are
 * browser-decodable and compress well enough to be bomb material. The insert path accepts any
 * `image/*` type, so an AVIF still reaches the decoder unchecked — exactly as every format did
 * before this module existed. That is a narrower guarantee than "images are checked", not a
 * regression, and closing it means reading the ISOBMFF `ispe` box here. Say "PNG/JPEG/GIF/WebP" when
 * describing what is protected, never "images".
 *
 * Hostile input is the normal case for this module: every read is bounds-checked and it never
 * throws, on any byte sequence, truncated or not.
 */

/** A raster format whose header this module can read. */
export type ReadableImageFormat = "png" | "jpeg" | "gif" | "webp";

export interface ImageHeaderSize {
  format: ReadableImageFormat;
  width: number;
  height: number;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function readUInt32BE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.length) return null;
  return bytes[offset]! * 0x1000000 + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!;
}

function readUInt16BE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 2 > bytes.length) return null;
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUInt16LE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 2 > bytes.length) return null;
  return (bytes[offset + 1]! << 8) | bytes[offset]!;
}

function readUInt24LE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 3 > bytes.length) return null;
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

/** PNG: an 8-byte signature, then the IHDR chunk, whose width/height sit at a fixed offset. */
function readPngSize(bytes: Uint8Array): ImageHeaderSize | null {
  const width = readUInt32BE(bytes, 16);
  const height = readUInt32BE(bytes, 20);
  if (width === null || height === null) return null;
  return { format: "png", width, height };
}

/**
 * JPEG: a marker walk. Dimensions live in whichever SOFn frame header comes first, which is not at a
 * fixed offset — segments (EXIF, ICC profiles, thumbnails) precede it and each declares its own
 * length. The walk is bounded by the buffer and by a segment count so a crafted chain of zero-length
 * segments cannot spin here.
 */
function readJpegSize(bytes: Uint8Array): ImageHeaderSize | null {
  let offset = 2; // past SOI
  for (let segment = 0; segment < 1024; segment += 1) {
    // Markers are 0xFF followed by a type byte; padding 0xFF bytes between segments are legal.
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset]!;
    offset += 1;
    // SOF0..SOF15 carry the frame size, except the non-frame markers interleaved in that range.
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    const length = readUInt16BE(bytes, offset);
    if (length === null || length < 2) return null;
    if (isStartOfFrame) {
      const height = readUInt16BE(bytes, offset + 3);
      const width = readUInt16BE(bytes, offset + 5);
      if (width === null || height === null) return null;
      return { format: "jpeg", width, height };
    }
    if (marker === 0xda) return null; // start of scan: past the headers, no frame size found
    offset += length;
    if (offset >= bytes.length) return null;
    // The next segment must start on a marker; anything else means the stream is malformed.
    if (bytes[offset] !== 0xff) return null;
  }
  return null;
}

/** GIF: the logical screen descriptor, little-endian, right after the 6-byte signature. */
function readGifSize(bytes: Uint8Array): ImageHeaderSize | null {
  const width = readUInt16LE(bytes, 6);
  const height = readUInt16LE(bytes, 8);
  if (width === null || height === null) return null;
  return { format: "gif", width, height };
}

/** WebP: a RIFF container whose size lives in one of three chunk layouts (lossy VP8, lossless VP8L, extended VP8X). */
function readWebpSize(bytes: Uint8Array): ImageHeaderSize | null {
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8 ") {
    // Lossy: a 3-byte start code, then 14-bit width/height each with 2 scaling bits above them.
    if (bytes.length < 30) return null;
    const width = readUInt16LE(bytes, 26);
    const height = readUInt16LE(bytes, 28);
    if (width === null || height === null) return null;
    return { format: "webp", width: width & 0x3fff, height: height & 0x3fff };
  }
  if (chunk === "VP8L") {
    // Lossless: one signature byte, then 14-bit width-1 and height-1 packed across four bytes.
    if (bytes.length < 25) return null;
    const packed = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
    return { format: "webp", width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    // Extended: 24-bit little-endian canvas width-1/height-1 after the flag and reserved bytes.
    const width = readUInt24LE(bytes, 24);
    const height = readUInt24LE(bytes, 27);
    if (width === null || height === null) return null;
    return { format: "webp", width: width + 1, height: height + 1 };
  }
  return null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF_SIGNATURE = [0x47, 0x49, 0x46, 0x38]; // "GIF8" — covers both 87a and 89a
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50]; // "WEBP", at offset 8

/**
 * The declared pixel size of `bytes`, or `null` when the format is not one this can read or the
 * header is truncated/malformed. Never throws.
 */
export function readImageHeaderSize(bytes: Uint8Array): ImageHeaderSize | null {
  try {
    if (startsWith(bytes, PNG_SIGNATURE)) return readPngSize(bytes);
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return readJpegSize(bytes);
    if (startsWith(bytes, GIF_SIGNATURE)) return readGifSize(bytes);
    if (startsWith(bytes, RIFF_SIGNATURE) && startsWith(bytes, WEBP_SIGNATURE, 8)) return readWebpSize(bytes);
    return null;
  } catch {
    // Defence in depth: the readers above are all bounds-checked, so reaching here would be a bug —
    // but this function's contract with hostile input is "never throws", and that must hold even then.
    return null;
  }
}
