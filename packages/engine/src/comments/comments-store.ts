/**
 * The scene's comment threads and messages — a composed unit on `Scene`, exactly the architectural
 * slot `SceneLayersStore` occupies: it NEVER notifies (the `Scene` owns the change signal and wraps
 * every mutator in a notifying facade), and it exposes an O(1) `getVersion()` so hot-path
 * subscribers can ask "did comments change?" without a scan.
 *
 * Convergence rule: every record resolves with the single shared LWW comparison
 * (`scene/lww-record.ts`), and deletion is a SOFT delete carried on the record itself. That is a
 * deliberate divergence from `scene-layers.ts`, which needs an explicit tombstone SET because its
 * wholesale manifest has no per-record field in which a deletion could travel and win a comparison.
 * Here the deletion IS a record with a bumped version, so it wins on its own merits on every peer,
 * in any arrival order — and adding a tombstone set on top would actively break that: a locally
 * deleted id whose equal-version remote edit is blocked on one peer but wins the nonce tiebreak on
 * the other is how two peers end up permanently disagreeing.
 *
 * Comment mutations are NOT part of undo history (the layer-list / canvas-background precedent):
 * a conversation is not document geometry, and an undo that silently retracted someone's reply
 * would be worse than no undo at all.
 */
import { lwwRecordWins } from "../scene/lww-record";
import type { CommentAnchor, CommentMessage, CommentThread } from "./comment-types";
import { clampAuthorName, clampBody, MAX_COMMENT_MESSAGES, MAX_COMMENT_MESSAGES_PER_THREAD, MAX_COMMENT_THREADS, touchCommentRecord } from "./comment-types";

export class SceneCommentsStore {
  private readonly threads = new Map<string, CommentThread>();
  private readonly messages = new Map<string, CommentMessage>();
  /** threadId → message ids, kept in step with `messages` so `getMessages` never scans the whole map. Includes soft-deleted ids (they still count against the per-thread cap and still have to be findable to be un-deleted by a merge). */
  private readonly messageIdsByThread = new Map<string, Set<string>>();
  /**
   * Bumped on every change from ANY source (local mutation and remote adoption alike) — the cheap
   * O(1) "did comments change?" signal, deliberately separate from any record's LWW `version`,
   * which adoption SETS to a remote value that could numerically equal a prior local one and fool
   * an equality-gated subscriber.
   */
  private version = 0;

  // ---- Reads ---------------------------------------------------------------------------------

  /** Live (not soft-deleted) threads, newest last. Copies — callers cannot mutate store state through the return value. */
  getThreads(): CommentThread[] {
    return [...this.threads.values()].filter((thread) => !thread.isDeleted).map((thread) => ({ ...thread }));
  }

  /** Includes soft-deleted threads — the serialization path needs the tombstones so a delete survives a save/reload and can still win a later merge. */
  getAllThreads(): CommentThread[] {
    return [...this.threads.values()].map((thread) => ({ ...thread }));
  }

  getThread(id: string): CommentThread | undefined {
    const thread = this.threads.get(id);
    return thread ? { ...thread } : undefined;
  }

  /** Live messages of one thread in creation order — the order a conversation reads in, stable across peers because `created` is stamped once by the author and never rewritten. */
  getMessages(threadId: string): CommentMessage[] {
    const ids = this.messageIdsByThread.get(threadId);
    if (!ids) return [];
    const messages: CommentMessage[] = [];
    for (const id of ids) {
      const message = this.messages.get(id);
      if (message && !message.isDeleted) messages.push({ ...message });
    }
    return messages.sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
  }

  getAllMessages(): CommentMessage[] {
    return [...this.messages.values()].map((message) => ({ ...message }));
  }

  getMessage(id: string): CommentMessage | undefined {
    const message = this.messages.get(id);
    return message ? { ...message } : undefined;
  }

  /** Monotonic counter of changes from any source — see the field doc. */
  getVersion(): number {
    return this.version;
  }

  /** True when this store holds no records at all. Serialization omits both arrays then, so a scene that never had a comment stays byte-identical to pre-comments output. */
  isEmpty(): boolean {
    return this.threads.size === 0 && this.messages.size === 0;
  }

  // ---- Local mutations -----------------------------------------------------------------------

  /** Inserts an already-built thread (see `createCommentThread`), stamping its first version. Returns the stored copy, or `null` when the thread cap is already reached. */
  addThread(thread: CommentThread, now?: number): CommentThread | null {
    if (this.threads.size >= MAX_COMMENT_THREADS) return null;
    const stored = touchCommentRecord(thread, { authorName: clampAuthorName(thread.authorName) } as Partial<CommentThread>, now);
    this.threads.set(stored.id, stored);
    this.version += 1;
    return { ...stored };
  }

  /** Inserts a message. Refused for an unknown/deleted thread, and once either message cap is reached — a reply into a thread that no longer exists would be invisible anyway. */
  addMessage(message: CommentMessage, now?: number): CommentMessage | null {
    const thread = this.threads.get(message.threadId);
    if (!thread || thread.isDeleted) return null;
    if (this.messages.size >= MAX_COMMENT_MESSAGES) return null;
    if ((this.messageIdsByThread.get(message.threadId)?.size ?? 0) >= MAX_COMMENT_MESSAGES_PER_THREAD) return null;
    // Clamped here as well as in the factory: the store is the invariant boundary, and a caller that
    // built its record by hand (a headless host, a restored draft) must not be able to slip past the cap.
    const stored = touchCommentRecord(message, { body: clampBody(message.body), authorName: clampAuthorName(message.authorName) } as Partial<CommentMessage>, now);
    this.storeMessage(stored);
    this.version += 1;
    return { ...stored };
  }

  /**
   * Edits a message body. `authorId` is the caller's identity: only the author may edit their own
   * message, and the check lives here (not only in the UI) so every host — React shell, MCP,
   * headless — gets the same rule. Returns the updated copy, or `null` when refused.
   */
  editMessage(id: string, body: string, authorId: string, now?: number): CommentMessage | null {
    const message = this.messages.get(id);
    if (!message || message.isDeleted || message.authorId !== authorId) return null;
    const clamped = clampBody(body);
    if (clamped === message.body) return null;
    const stored = touchCommentRecord(message, { body: clamped }, now);
    this.storeMessage(stored);
    this.version += 1;
    return { ...stored };
  }

  setResolved(threadId: string, resolved: boolean, now?: number): CommentThread | null {
    const thread = this.threads.get(threadId);
    if (!thread || thread.isDeleted || thread.resolved === resolved) return null;
    const stored = touchCommentRecord(thread, { resolved }, now);
    this.threads.set(stored.id, stored);
    this.version += 1;
    return { ...stored };
  }

  /** Repoints a thread's pin — used when a thread's anchor element is gone and the user drags the orphaned pin, never as part of read-time resolution (see `comment-anchor.ts`). */
  setAnchor(threadId: string, anchor: CommentAnchor, now?: number): CommentThread | null {
    const thread = this.threads.get(threadId);
    if (!thread || thread.isDeleted) return null;
    const stored = touchCommentRecord(thread, { anchor }, now);
    this.threads.set(stored.id, stored);
    this.version += 1;
    return { ...stored };
  }

  /**
   * Soft-deletes a thread. Its messages are deliberately left untouched rather than deleted one by
   * one: they are unreachable through a deleted thread, and N extra version bumps would be N extra
   * deltas on the wire for no observable difference.
   */
  deleteThread(threadId: string, now?: number): CommentThread | null {
    const thread = this.threads.get(threadId);
    if (!thread || thread.isDeleted) return null;
    const stored = touchCommentRecord(thread, { isDeleted: true }, now);
    this.threads.set(stored.id, stored);
    this.version += 1;
    return { ...stored };
  }

  /** Soft-deletes one message — author-only, same reasoning as `editMessage`. */
  deleteMessage(id: string, authorId: string, now?: number): CommentMessage | null {
    const message = this.messages.get(id);
    if (!message || message.isDeleted || message.authorId !== authorId) return null;
    const stored = touchCommentRecord(message, { isDeleted: true }, now);
    this.storeMessage(stored);
    this.version += 1;
    return { ...stored };
  }

  /** Renames the local author's display name across their own records, so an editable name is not retroactively inconsistent. Returns the records that changed, for the caller to flush onto the wire. */
  renameAuthor(authorId: string, authorName: string, now?: number): { threads: CommentThread[]; messages: CommentMessage[] } {
    const name = clampAuthorName(authorName);
    const threads: CommentThread[] = [];
    const messages: CommentMessage[] = [];
    for (const thread of this.threads.values()) {
      if (thread.authorId !== authorId || thread.authorName === name) continue;
      const stored = touchCommentRecord(thread, { authorName: name }, now);
      this.threads.set(stored.id, stored);
      threads.push({ ...stored });
    }
    for (const message of this.messages.values()) {
      if (message.authorId !== authorId || message.authorName === name) continue;
      const stored = touchCommentRecord(message, { authorName: name }, now);
      this.storeMessage(stored);
      messages.push({ ...stored });
    }
    if (threads.length > 0 || messages.length > 0) this.version += 1;
    return { threads, messages };
  }

  // ---- Remote adoption -----------------------------------------------------------------------

  /**
   * LWW adoption of a remote thread record — the winner lands byte-for-byte (no `touchCommentRecord`),
   * or two peers receiving the same delta would each mint a fresh version and never converge.
   * Returns whether anything changed, which the caller uses to skip a pointless notify/rebroadcast.
   */
  applyRemoteThread(thread: CommentThread): boolean {
    const local = this.threads.get(thread.id);
    if (!lwwRecordWins(local, thread)) return false;
    if (!local && this.threads.size >= MAX_COMMENT_THREADS) return false;
    this.threads.set(thread.id, Object.freeze({ ...thread }));
    this.version += 1;
    return true;
  }

  /**
   * LWW adoption of a remote message. Accepted even when its thread has not arrived yet — messages
   * and threads are independent records on the wire and either order is legal; the message simply
   * stays invisible until its thread lands. Caps still apply so a hostile peer cannot flood memory.
   */
  applyRemoteMessage(message: CommentMessage): boolean {
    const local = this.messages.get(message.id);
    if (!lwwRecordWins(local, message)) return false;
    if (!local) {
      if (this.messages.size >= MAX_COMMENT_MESSAGES) return false;
      if ((this.messageIdsByThread.get(message.threadId)?.size ?? 0) >= MAX_COMMENT_MESSAGES_PER_THREAD) return false;
    }
    this.storeMessage(Object.freeze({ ...message }));
    this.version += 1;
    return true;
  }

  /**
   * Replaces every record from a deserialized document. Over-cap inputs are truncated rather than
   * rejected: a document whose comment list is corrupt should lose comments, never fail to open.
   */
  replaceAll(threads: readonly CommentThread[], messages: readonly CommentMessage[]): void {
    this.threads.clear();
    this.messages.clear();
    this.messageIdsByThread.clear();
    for (const thread of threads.slice(0, MAX_COMMENT_THREADS)) this.threads.set(thread.id, Object.freeze({ ...thread }));
    for (const message of messages.slice(0, MAX_COMMENT_MESSAGES)) {
      if ((this.messageIdsByThread.get(message.threadId)?.size ?? 0) >= MAX_COMMENT_MESSAGES_PER_THREAD) continue;
      this.storeMessage(Object.freeze({ ...message }));
    }
    this.version += 1;
  }

  private storeMessage(message: CommentMessage): void {
    this.messages.set(message.id, message);
    let ids = this.messageIdsByThread.get(message.threadId);
    if (!ids) {
      ids = new Set();
      this.messageIdsByThread.set(message.threadId, ids);
    }
    ids.add(message.id);
  }
}
