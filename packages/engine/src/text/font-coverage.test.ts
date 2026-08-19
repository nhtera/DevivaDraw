/**
 * Guards the shipped hand-drawn font's glyph coverage by reading the artifact itself: decode the
 * base64 `woff2` from `hand-drawn-font-data.ts`, pull its `cmap` out of the compressed table stream,
 * and assert the codepoints that matter are really in it.
 *
 * This exists because the previous bundled face covered Latin-1 only, so Vietnamese silently fell
 * back to the sans stack mid-sentence — on canvas and in every export. A dropped range is invisible
 * until someone types the wrong language, which is exactly the kind of regression a test should
 * catch instead of a user.
 *
 * The `woff2` reader below is deliberately minimal: a `woff2` file is a header, a table directory
 * with variable-length lengths, then one brotli stream holding the tables back to back. `cmap` is
 * never transformed (only `glyf`/`loca` are), so slicing it out of the decompressed stream at its
 * directory offset gives the real table.
 */
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { HAND_DRAWN_FONT_DATA_URL } from "./hand-drawn-font-data";

/** `woff2`'s table directory stores a 6-bit index into this fixed tag list instead of a 4-byte tag, with 0x3f meaning "an arbitrary tag follows". Order is normative (WOFF2 spec, "Known Table Tags"). */
const KNOWN_TABLE_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

/** `UIntBase128`: big-endian, 7 bits per byte, high bit set on every byte but the last. Returns the value and the offset just past it. */
function readUIntBase128(bytes: Buffer, offset: number): [value: number, next: number] {
  let value = 0;
  for (let index = 0; index < 5; index += 1) {
    const byte = bytes[offset + index]!;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, offset + index + 1];
  }
  throw new Error("malformed UIntBase128 in woff2 table directory");
}

/** Raw bytes of one table from a `woff2` file, or `undefined` if the font has no such table. */
function readWoff2Table(font: Buffer, wanted: string): Buffer | undefined {
  expect(font.toString("latin1", 0, 4)).toBe("wOF2");
  const tableCount = font.readUInt16BE(12);
  let cursor = 48;
  const directory: { tag: string; length: number }[] = [];
  for (let index = 0; index < tableCount; index += 1) {
    const flags = font[cursor]!;
    cursor += 1;
    const tagIndex = flags & 0x3f;
    let tag: string;
    if (tagIndex === 0x3f) {
      tag = font.toString("latin1", cursor, cursor + 4);
      cursor += 4;
    } else tag = KNOWN_TABLE_TAGS[tagIndex]!;
    let length: number;
    [length, cursor] = readUIntBase128(font, cursor);
    // A transformed table stores its transformed length separately; `glyf`/`loca` are transformed
    // when their transform bits are 0, every other table when they are non-zero.
    const transform = (flags >> 6) & 0x03;
    const isGlyfOrLoca = tag === "glyf" || tag === "loca";
    if (isGlyfOrLoca ? transform === 0 : transform !== 0) [length, cursor] = readUIntBase128(font, cursor);
    directory.push({ tag, length });
  }
  const tables = brotliDecompressSync(font.subarray(cursor));
  let offset = 0;
  for (const entry of directory) {
    if (entry.tag === wanted) return tables.subarray(offset, offset + entry.length);
    offset += entry.length;
  }
  return undefined;
}

/** Every codepoint mapped to a non-zero glyph by a `cmap` table's format 4 and format 12 subtables. */
function cmapCodepoints(cmap: Buffer): Set<number> {
  const codepoints = new Set<number>();
  const subtableCount = cmap.readUInt16BE(2);
  for (let index = 0; index < subtableCount; index += 1) {
    const subtable = cmap.readUInt32BE(8 + index * 8);
    const format = cmap.readUInt16BE(subtable);
    if (format === 4) {
      const segmentCountX2 = cmap.readUInt16BE(subtable + 6);
      const endCodes = subtable + 14;
      const startCodes = endCodes + segmentCountX2 + 2;
      const idDeltas = startCodes + segmentCountX2;
      const idRangeOffsets = idDeltas + segmentCountX2;
      for (let segment = 0; segment < segmentCountX2 / 2; segment += 1) {
        const end = cmap.readUInt16BE(endCodes + segment * 2);
        const start = cmap.readUInt16BE(startCodes + segment * 2);
        if (start === 0xffff) continue;
        const idDelta = cmap.readInt16BE(idDeltas + segment * 2);
        const rangeOffset = cmap.readUInt16BE(idRangeOffsets + segment * 2);
        for (let codepoint = start; codepoint <= end; codepoint += 1) {
          if (rangeOffset === 0) {
            // Glyph id is `(codepoint + idDelta) mod 65536`, and 0 is `.notdef` — a segment can
            // cover a range while mapping individual codepoints in it to nothing. Counting those as
            // present would let a re-subset drop a glyph without this test noticing.
            if (((codepoint + idDelta) & 0xffff) !== 0) codepoints.add(codepoint);
            continue;
          }
          const glyphAddress = idRangeOffsets + segment * 2 + rangeOffset + (codepoint - start) * 2;
          if (glyphAddress + 1 < cmap.length && cmap.readUInt16BE(glyphAddress) !== 0) codepoints.add(codepoint);
        }
      }
    } else if (format === 12) {
      const groupCount = cmap.readUInt32BE(subtable + 12);
      for (let group = 0; group < groupCount; group += 1) {
        const base = subtable + 16 + group * 12;
        const start = cmap.readUInt32BE(base);
        const end = cmap.readUInt32BE(base + 4);
        for (let codepoint = start; codepoint <= end; codepoint += 1) codepoints.add(codepoint);
      }
    }
  }
  return codepoints;
}

function shippedCodepoints(): Set<number> {
  const base64 = HAND_DRAWN_FONT_DATA_URL.slice(HAND_DRAWN_FONT_DATA_URL.indexOf(",") + 1);
  const cmap = readWoff2Table(Buffer.from(base64, "base64"), "cmap");
  expect(cmap, "shipped font has no cmap table").toBeDefined();
  return cmapCodepoints(cmap as Buffer);
}

describe("bundled hand-drawn font coverage", () => {
  const codepoints = shippedCodepoints();

  it("covers the Vietnamese fixture that the previous Latin-only subset fell back on", () => {
    const fixture = "Tiếng Việt — Đường ữ ơ ạ ẩ ằ é ü ñ ł ő ș ž";
    const missing = [...new Set([...fixture])].filter((character) => character !== " " && !codepoints.has(character.codePointAt(0) as number));
    expect(missing).toEqual([]);
  });

  // One assertion per range the generator declares, so a failure names the range that went missing
  // rather than a codepoint the reader has to look up. Sampled at the edges and inside: proving a
  // whole range survived is what matters, not every glyph in it.
  it.each([
    ["Latin-1 Supplement", [0x00c0, 0x00e9, 0x00ff]],
    ["Latin Extended-A", [0x0100, 0x0111, 0x0142, 0x0151, 0x017e]],
    ["Latin Extended-B", [0x01a0, 0x01a1, 0x01af, 0x01b0, 0x0219]],
    ["Vietnamese combining marks", [0x0300, 0x0301, 0x0303, 0x0309, 0x0323]],
    ["Vietnamese precomposed", [0x1ea0, 0x1ebf, 0x1ec7, 0x1ee9, 0x1ef9]],
    ["editor punctuation", [0x2013, 0x2014, 0x2018, 0x201d, 0x2026, 0x2212]],
  ])("covers %s", (_range, sampled) => {
    expect(sampled.filter((codepoint) => !codepoints.has(codepoint))).toEqual([]);
  });

  it("stays within the bundle budget for an inlined data URI", () => {
    // 80 KB of base64 is the agreed ceiling — the font is inlined into the bundle, so this is bytes
    // every visitor downloads before first paint. Blowing it is a decision, not an accident.
    expect(HAND_DRAWN_FONT_DATA_URL.length).toBeLessThan(80 * 1024);
  });
});
