/**
 * External-change decision logic for the open document's on-disk file — pure functions so the
 * watcher plumbing in `document-host.ts` stays a thin shell. Two concerns:
 *
 * 1. Self-write suppression: the app records a hash of exactly what it wrote (post-atomic-rename,
 *    so a watcher can never observe a partial file); a "modified" event whose content hashes the
 *    same is the app's own save echoing back and must not reload.
 * 2. The conflict rule: an external change over UNSAVED local edits never auto-merges and never
 *    silently clobbers either side — it becomes a user decision (conflict bar).
 */

export type ExternalChangeDecision = "suppress" | "reload" | "conflict";

export function decideOnModify(options: { changedHash: string; lastWrittenHash: string | null; dirty: boolean }): ExternalChangeDecision {
  if (options.lastWrittenHash !== null && options.changedHash === options.lastWrittenHash) return "suppress";
  return options.dirty ? "conflict" : "reload";
}

/**
 * FNV-1a, 32-bit, hex — collision-resistance only needs to beat "the same document text twice";
 * this guards an echo, not an adversary.
 */
export function contentHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** Last self-written content hash per absolute path — written by the provider's `writeFile`, read by the watcher. */
const writtenHashes = new Map<string, string>();

export function recordWrittenContent(path: string, text: string): void {
  writtenHashes.set(path, contentHash(text));
}

export function lastWrittenHash(path: string): string | null {
  return writtenHashes.get(path) ?? null;
}

/** Evicts a path no longer being watched — the registry must not outlive the document it guards. */
export function clearWrittenHash(path: string): void {
  writtenHashes.delete(path);
}
