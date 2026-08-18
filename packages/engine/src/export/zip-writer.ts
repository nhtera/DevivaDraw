/**
 * A minimal ZIP archive writer — enough of the format to build the container an Office Open XML file
 * is (`.pptx` is a ZIP of XML parts and media), without a compression dependency.
 *
 * Entries are written with the STORE method (no compression), which is what removes the dependency:
 * DEFLATE would need a compressor, while STORE needs only the record layout and a CRC-32. The cost is
 * archive size, and it is the right trade here because the bytes that dominate a slide deck are PNGs,
 * which are already DEFLATE-compressed internally — re-compressing them would buy close to nothing.
 * Every ZIP reader, including every Office consumer, must support STORE.
 *
 * Records written, in the order a reader expects them:
 *   [local header + data] × n, [central directory header] × n, end-of-central-directory
 *
 * Timestamps come from an injected `now` rather than the wall clock: the engine owns no clock-dependent
 * defaults, and an exporter whose output changes byte-for-byte between two identical runs cannot be
 * tested against a fixture. Sizes are 32-bit — no ZIP64 — which caps an archive (and any single entry)
 * at 4 GB. A slide deck that large is not a case this exists to serve.
 */
import { crc32 } from "./crc32";

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
/** "2.0" — the version that STORE + the record layout below require. */
const VERSION = 20;
/** General-purpose bit 11: file names are UTF-8. Ours are ASCII, but declaring it is what makes that a guarantee rather than an accident. */
const UTF8_NAME_FLAG = 0x0800;
const STORE_METHOD = 0;

interface ZipEntry {
  name: Uint8Array;
  data: Uint8Array;
  crc: number;
  /** Byte offset of this entry's local header, needed by its central-directory record. */
  offset: number;
}

/** MS-DOS packed date/time (UTC) for `epochMs`. Pre-1980 timestamps clamp to 1980-01-01 — the format's own epoch. */
export function dosDateTime(epochMs: number): { date: number; time: number } {
  const at = new Date(epochMs);
  const year = at.getUTCFullYear();
  if (year < 1980) return { date: (1 << 5) | 1, time: 0 };
  const date = ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate();
  // Seconds are stored in 2-second units — the format has 5 bits for them, so odd seconds are lost.
  const time = (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2);
  return { date, time };
}

/**
 * Accumulates entries, then emits the whole archive. Single-use in practice (build, call `toBytes()`),
 * but `toBytes()` is pure with respect to the accumulated entries and may be called more than once.
 */
export class ZipWriter {
  private readonly entries: ZipEntry[] = [];
  private readonly chunks: Uint8Array[] = [];
  private offset = 0;
  private readonly date: number;
  private readonly time: number;

  constructor(now: number) {
    const stamp = dosDateTime(now);
    this.date = stamp.date;
    this.time = stamp.time;
  }

  /** Adds one stored entry. `path` uses forward slashes and no leading slash, per the ZIP convention Office parts rely on. */
  addFile(path: string, data: Uint8Array): void {
    const name = new TextEncoder().encode(path);
    const crc = crc32(data);
    this.entries.push({ name, data, crc, offset: this.offset });
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
    view.setUint16(4, VERSION, true);
    view.setUint16(6, UTF8_NAME_FLAG, true);
    view.setUint16(8, STORE_METHOD, true);
    view.setUint16(10, this.time, true);
    view.setUint16(12, this.date, true);
    view.setUint32(14, crc, true);
    // Stored, so the compressed and uncompressed sizes are the same number by definition.
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    header.set(name, 30);
    this.chunks.push(header, data);
    this.offset += header.length + data.length;
  }

  /** Convenience for the XML parts, which are authored as strings. */
  addText(path: string, text: string): void {
    this.addFile(path, new TextEncoder().encode(text));
  }

  /** The finished archive. */
  toBytes(): Uint8Array {
    const directory: Uint8Array[] = [];
    let directorySize = 0;
    for (const entry of this.entries) {
      const record = new Uint8Array(46 + entry.name.length);
      const view = new DataView(record.buffer);
      view.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
      view.setUint16(4, VERSION, true);
      view.setUint16(6, VERSION, true);
      view.setUint16(8, UTF8_NAME_FLAG, true);
      view.setUint16(10, STORE_METHOD, true);
      view.setUint16(12, this.time, true);
      view.setUint16(14, this.date, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.data.length, true);
      view.setUint32(24, entry.data.length, true);
      view.setUint16(28, entry.name.length, true);
      // extra length, comment length, disk number, internal attrs, external attrs — all zero, and
      // deliberately so: none of them carry meaning for an Office part, and a reader that needed one
      // would be a reader that also needed ZIP64.
      view.setUint32(42, entry.offset, true);
      record.set(entry.name, 46);
      directory.push(record);
      directorySize += record.length;
    }

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
    endView.setUint16(8, this.entries.length, true);
    endView.setUint16(10, this.entries.length, true);
    endView.setUint32(12, directorySize, true);
    endView.setUint32(16, this.offset, true);

    return concatBytes([...this.chunks, ...directory, end]);
  }
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
