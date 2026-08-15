/**
 * This browser's record of share links it created — the ONLY place the revocation tokens exist (the
 * server stores just their hashes), which is what makes revoke work at all in a zero-knowledge
 * design, and also why links made in another browser/device can never appear here.
 *
 * Deliberately never stores the share URL or any key material: a persisted url would carry the
 * decryption key in its fragment, turning one XSS into bulk read access to every past share. An
 * entry grants exactly one power — revoking its own blob — so this is the least-capability record
 * that still makes revocation possible. Consequence: old links can't be re-copied from history;
 * only the freshly generated link (held in memory by the dialog) is copyable.
 *
 * On a shared/public machine, whoever uses the browser next inherits revoke ability (not content
 * access) — accepted: the alternative is a server-side account system, out of scope by design.
 */

export interface ShareLinkHistoryEntry {
  blobId: string;
  deleteToken: string;
  /** Epoch milliseconds at creation — display only. */
  createdAt: number;
  pageCount: number;
  /** ISO-8601 expiry the link was created with, when one was chosen — display only (the server enforces). */
  expiresAt?: string;
}

/** The minimal storage surface, injectable so tests run without a DOM `window`. */
export interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SHARE_LINK_HISTORY_STORAGE_KEY = "deviva-draw:share-links";

/** Oldest entries fall off past this — revocation is a recency-biased need, and an unbounded list of tokens only grows the shared-machine exposure. */
export const SHARE_LINK_HISTORY_CAP = 50;

/** Newest first. Corrupt/absent storage reads as empty — history is a convenience record, never worth an error surface. */
export function readShareLinkHistory(storage: HistoryStorage): ShareLinkHistoryEntry[] {
  let raw: string | null;
  try {
    raw = storage.getItem(SHARE_LINK_HISTORY_STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

function isValidEntry(candidate: unknown): candidate is ShareLinkHistoryEntry {
  if (typeof candidate !== "object" || candidate === null) return false;
  const entry = candidate as Record<string, unknown>;
  return (
    typeof entry.blobId === "string" &&
    typeof entry.deleteToken === "string" &&
    typeof entry.createdAt === "number" &&
    typeof entry.pageCount === "number" &&
    (entry.expiresAt === undefined || typeof entry.expiresAt === "string")
  );
}

/** Prepends `entry` (newest first), dropping the oldest past the cap. Quota/denied storage is swallowed — losing the history record never fails the share itself. */
export function appendShareLinkHistory(storage: HistoryStorage, entry: ShareLinkHistoryEntry): void {
  const next = [entry, ...readShareLinkHistory(storage).filter((existing) => existing.blobId !== entry.blobId)].slice(0, SHARE_LINK_HISTORY_CAP);
  try {
    storage.setItem(SHARE_LINK_HISTORY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded or storage denied — the link still works, it just won't be revocable from
    // history later; the dialog reads back what actually persisted.
  }
}

/** Drops the entry for `blobId` — called after a successful (or already-gone) revoke. */
export function removeShareLinkHistoryEntry(storage: HistoryStorage, blobId: string): void {
  const next = readShareLinkHistory(storage).filter((entry) => entry.blobId !== blobId);
  try {
    storage.setItem(SHARE_LINK_HISTORY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Same policy as append: a failed write only costs bookkeeping.
  }
}
