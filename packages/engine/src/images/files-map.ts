/**
 * Content-addressed store for the binary files an `ImageElement` references by `fileId` (see
 * `elements/image-element.ts`'s doc for why data never lives on the element itself). `Scene` owns one
 * instance alongside its element map — see `scene/scene.ts`.
 *
 * fileId choice: a hash of the file's raw bytes, not a random id. Two deliberate reasons: (1)
 * pasting/dropping the same image twice — a common flow (copy a screenshot, paste it into two
 * places) — reuses one `files` entry for free, since identical bytes always hash to the same id, with
 * no separate reverse-content lookup table needed; (2) it makes re-inserting into the store trivially
 * idempotent (a duplicate `set` for an id that already exists is a harmless no-op), which matters once
 * persistence (loading a saved scene) and collab (files arriving out of order relative to elements)
 * both call the same insert path. This is the explicit "dedup identical pastes" choice a later phase's
 * success criteria calls for — stated here rather than left ambiguous.
 */

export interface StoredFile {
  mimeType: string;
  /** Full `data:` URL (base64-encoded bytes) — see `bytesToDataURL`. */
  dataURL: string;
  createdAt: number;
}

/** Bytes per `String.fromCharCode.apply` chunk — comfortably under engines' max-argument-count limits, avoiding a stack overflow when base64-encoding a multi-megabyte image. */
const BASE64_CHUNK_SIZE = 0x8000;

/**
 * Converts raw bytes to a base64 `data:` URL — pure and DOM-free. Uses the cross-runtime `btoa`
 * (global in both browsers and Node 16+), not Node's `Buffer`, so this exact code path also runs
 * unchanged in the browser bundle.
 */
export function bytesToDataURL(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Pure-JS 32-bit FNV-1a — only reached in a runtime with no Web Crypto; collision risk is negligible for a single local session's worth of pasted images. */
function fnv1aHash(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Deterministic content id for `bytes`: SHA-256 via Web Crypto when available (real browsers and
 * Node 19+), falling back to a pure-JS FNV-1a hash otherwise — the same "prefer the real crypto API,
 * degrade gracefully" shape `elements/element-factory-defaults.ts`'s `generateElementId` uses for
 * `crypto.randomUUID`. See the module doc for why content-addressing (not a random id) is the point.
 */
export async function computeFileId(bytes: Uint8Array): Promise<string> {
  if (typeof crypto !== "undefined" && typeof crypto.subtle?.digest === "function") {
    // `BufferSource` requires an `ArrayBuffer`-backed view; `Uint8Array`'s type is generic over
    // `ArrayBufferLike` (which also covers `SharedArrayBuffer`), so TS can't statically prove this
    // particular view qualifies even though every caller in this codebase only ever passes a plain
    // `ArrayBuffer`-backed array (from `TextEncoder`/`Blob.arrayBuffer()`/file bytes).
    const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
    return toHex(new Uint8Array(digest));
  }
  return fnv1aHash(bytes);
}

/**
 * Thin `Map` wrapper `Scene` composes for `Scene.files` — see `scene/scene.ts`. `set` is a no-op
 * (returns `false`) when `fileId` already has an entry: with content-addressed ids (see module doc)
 * that's exactly the "identical bytes pasted twice" dedup case, not a bug — the existing entry is
 * already correct, so there's nothing to overwrite.
 */
export class FilesMap {
  private readonly files = new Map<string, StoredFile>();

  get(fileId: string): StoredFile | undefined {
    return this.files.get(fileId);
  }

  has(fileId: string): boolean {
    return this.files.has(fileId);
  }

  /** Inserts `file` under `fileId` if not already present. Returns whether it was actually inserted (`false` on a dedup no-op). */
  set(fileId: string, file: StoredFile): boolean {
    if (this.files.has(fileId)) return false;
    this.files.set(fileId, file);
    return true;
  }

  keys(): IterableIterator<string> {
    return this.files.keys();
  }

  get size(): number {
    return this.files.size;
  }

  /**
   * Removes every stored file whose id is not in `liveFileIds` — call explicitly (e.g. before a
   * persistence export), once a caller has computed which files are still referenced by a
   * non-deleted `ImageElement`; see `scene/scene.ts`'s `pruneOrphanedFiles`. Never wired to run
   * automatically on element delete: `Scene` never hard-purges soft-deleted elements either (see
   * `scene.ts`'s `deleteElement` doc) specifically so undo can restore one — an eagerly-pruned file
   * would leave a since-restored image element pointing at nothing. Returns the removed ids.
   */
  pruneOrphaned(liveFileIds: ReadonlySet<string>): string[] {
    const removed: string[] = [];
    for (const fileId of this.files.keys()) {
      if (!liveFileIds.has(fileId)) removed.push(fileId);
    }
    for (const fileId of removed) this.files.delete(fileId);
    return removed;
  }
}
