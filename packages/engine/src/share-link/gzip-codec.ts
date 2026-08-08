/**
 * Thin wrapper over the platform's native `CompressionStream`/`DecompressionStream` — used to shrink
 * scene JSON *before* AES-GCM encryption (see `encrypt-scene.ts`'s module doc: compressing ciphertext
 * afterward is pointless, encrypted bytes are already high-entropy). Available natively in every
 * modern browser and in Node 18+, so no bundled gzip dependency is needed here (YAGNI).
 */

// `BodyInit`/`BufferSource` require an `ArrayBuffer`-backed view; `Uint8Array`'s type is generic over
// `ArrayBufferLike` (which also covers `SharedArrayBuffer`), so TS can't statically prove a caller's
// view qualifies even though every caller in this codebase only ever passes a plain `ArrayBuffer`-
// backed array — see `images/files-map.ts`'s `computeFileId` for the same cast pattern.

export async function gzipCompress(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(bytes as Uint8Array<ArrayBuffer>).body!.pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gzipDecompress(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(bytes as Uint8Array<ArrayBuffer>).body!.pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
