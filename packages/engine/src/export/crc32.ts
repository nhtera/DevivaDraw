/**
 * CRC-32 (the ISO-HDLC / zlib polynomial, `0xedb88320` reflected) — shared by the two container
 * formats this package hand-rolls rather than pulling a dependency for: PNG's length-prefixed chunks
 * (`png-chunk-writer.ts`) and ZIP's local/central directory records (`zip-writer.ts`).
 *
 * They are the same checksum, and having two copies of the table would be two places for a
 * transcription error to hide in code whose whole job is producing bytes another program must accept.
 */

/** The lookup table, built once at module load. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
