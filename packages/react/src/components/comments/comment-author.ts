/**
 * Who the local user is when they comment.
 *
 * There are no accounts, so authorship reuses the ephemeral collab identity (`randomGuestName`) —
 * but with one difference that matters: a comment OUTLIVES the session that wrote it, so a name
 * regenerated on every mount would leave a board full of threads by a dozen different "Guest"s who
 * were all the same person. Both the id and the name are therefore persisted on first use, in their
 * own storage key (the `grid-storage.ts` / `object-snap-storage.ts` per-preference pattern) rather
 * than riding the scene autosave.
 *
 * The id is what the author-only edit/delete rule compares (`SceneCommentsStore.editMessage`), which
 * makes it a convenience, not a security boundary: it is a value in this browser's localStorage, so
 * anyone can claim any id. That is the correct trade for a no-signup product — the real boundary is
 * who has the room link, and phase 3's relay-enforced roles.
 */
import type { StorageLike } from "../../theme/theme-storage";
import { randomGuestName } from "../../hooks/random-collab-identity";

const COMMENT_AUTHOR_STORAGE_KEY = "devivadraw:comment-author:v1";

export interface CommentAuthor {
  id: string;
  name: string;
}

function generateAuthorId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `author-${Math.random().toString(36).slice(2)}`;
}

/** Parses a stored value per-field, so one corrupt half never costs the user their whole identity (the editor-preferences rationale). Returns `null` when nothing usable was stored. */
export function parseCommentAuthor(raw: string | null): CommentAuthor | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const id = typeof record.id === "string" && record.id.length > 0 ? record.id : null;
    if (!id) return null;
    return { id, name: typeof record.name === "string" && record.name.length > 0 ? record.name : randomGuestName() };
  } catch {
    return null;
  }
}

/** The stored identity, minting and persisting one on first use so it is stable across reloads. */
export function readStoredCommentAuthor(storage: StorageLike): CommentAuthor {
  const stored = parseCommentAuthor(storage.getItem(COMMENT_AUTHOR_STORAGE_KEY));
  if (stored) return stored;
  const created: CommentAuthor = { id: generateAuthorId(), name: randomGuestName() };
  writeStoredCommentAuthor(storage, created);
  return created;
}

export function writeStoredCommentAuthor(storage: StorageLike, author: CommentAuthor): void {
  try {
    storage.setItem(COMMENT_AUTHOR_STORAGE_KEY, JSON.stringify(author));
  } catch (error) {
    console.warn("deviva-draw: could not persist the comment author identity", error);
  }
}

// --- Module-level store (thin wiring over the tested functions above; the localStorage/subscription
// --- glue itself is not unit tested, per the editor-preferences precedent) ---

let current: CommentAuthor | null = null;
const listeners = new Set<() => void>();

function liveStorage(): StorageLike | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

/** The local author, hydrated on first read then cached (stable identity for `useSyncExternalStore`). */
export function getCommentAuthor(): CommentAuthor {
  if (current) return current;
  const storage = liveStorage();
  // Server-render/headless: an unpersisted identity is still better than none — the user can comment,
  // and the next browser read mints the durable one.
  current = storage ? readStoredCommentAuthor(storage) : { id: generateAuthorId(), name: randomGuestName() };
  return current;
}

/** Renames the local author. Callers that hold a `Scene` should follow this with `scene.renameCommentAuthor(...)` so existing records stop showing the old name. */
export function setCommentAuthorName(name: string): void {
  const trimmed = name.trim();
  if (trimmed === "") return;
  const next: CommentAuthor = { ...getCommentAuthor(), name: trimmed };
  current = next;
  const storage = liveStorage();
  if (storage) writeStoredCommentAuthor(storage, next);
  for (const listener of listeners) listener();
}

export function subscribeCommentAuthor(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
