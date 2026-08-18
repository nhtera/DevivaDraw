import { describe, expect, it } from "vitest";
import { crc32 } from "./crc32";
import { dosDateTime, ZipWriter } from "./zip-writer";

/** 2026-08-18T10:20:30Z — a fixed instant, so every expectation below is about the writer, not the clock. */
const NOW = Date.UTC(2026, 7, 18, 10, 20, 30);

const text = (value: string) => new TextEncoder().encode(value);

/**
 * A deliberately independent reader: it walks the END-OF-CENTRAL-DIRECTORY → central directory →
 * local header chain the way a real consumer does, rather than re-deriving offsets the way the writer
 * did. A test that trusted the writer's own arithmetic would pass on a mis-linked archive.
 */
function readArchive(bytes: Uint8Array): { name: string; data: Uint8Array; crc: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = bytes.length - 22;
  expect(view.getUint32(endOffset, true)).toBe(0x06054b50);
  const count = view.getUint16(endOffset + 10, true);
  let at = view.getUint32(endOffset + 16, true);

  const files: { name: string; data: Uint8Array; crc: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));

    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    expect(view.getUint16(localOffset + 8, true)).toBe(0); // STORE
    const localNameLength = view.getUint16(localOffset + 26, true);
    const extraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + extraLength;
    files.push({ name, data: bytes.subarray(dataStart, dataStart + size), crc });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return files;
}

describe("ZipWriter", () => {
  it("round-trips names and contents through a real central-directory walk", () => {
    const zip = new ZipWriter(NOW);
    zip.addText("[Content_Types].xml", "<Types/>");
    zip.addFile("ppt/media/image1.png", new Uint8Array([1, 2, 3, 4, 5]));
    const files = readArchive(zip.toBytes());

    expect(files.map((file) => file.name)).toEqual(["[Content_Types].xml", "ppt/media/image1.png"]);
    expect(new TextDecoder().decode(files[0]!.data)).toBe("<Types/>");
    expect([...files[1]!.data]).toEqual([1, 2, 3, 4, 5]);
  });

  it("stores a CRC a reader can verify against the data it points at", () => {
    const zip = new ZipWriter(NOW);
    const payload = text("slide one");
    zip.addFile("ppt/slides/slide1.xml", payload);
    const [file] = readArchive(zip.toBytes());
    expect(file!.crc).toBe(crc32(payload));
  });

  it("writes an empty archive as a valid end-of-central-directory record alone", () => {
    const bytes = new ZipWriter(NOW).toBytes();
    expect(bytes).toHaveLength(22);
    expect(readArchive(bytes)).toEqual([]);
  });

  it("is byte-identical across two runs at the same instant, so output is fixture-testable", () => {
    const build = () => {
      const zip = new ZipWriter(NOW);
      zip.addText("a.xml", "<a/>");
      return zip.toBytes();
    };
    expect([...build()]).toEqual([...build()]);
  });

  it("packs the DOS date/time fields the format specifies", () => {
    // 2026-08-18 10:20:30Z: year offset 46, month 8, day 18; seconds stored in 2-second units.
    expect(dosDateTime(NOW)).toEqual({ date: (46 << 9) | (8 << 5) | 18, time: (10 << 11) | (20 << 5) | 15 });
  });

  it("clamps a pre-1980 timestamp to the format's own epoch instead of emitting a negative year", () => {
    expect(dosDateTime(Date.UTC(1970, 0, 1))).toEqual({ date: (1 << 5) | 1, time: 0 });
  });

  it("declares UTF-8 names so a non-ASCII part name is unambiguous", () => {
    const zip = new ZipWriter(NOW);
    zip.addText("ppt/notesSlide/ghi-chú.xml", "<x/>");
    const bytes = zip.toBytes();
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
    expect(readArchive(bytes)[0]!.name).toBe("ppt/notesSlide/ghi-chú.xml");
  });
});
