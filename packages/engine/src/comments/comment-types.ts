/**
 * The comment record model: threads and their messages.
 *
 * Comments are records PARALLEL to elements, never elements themselves — they never appear in
 * `getElements()`, never export to PNG/SVG, never take part in selection/transform/z-order, and
 * carry their own permission rule (only an author edits their own message). That is why they get
 * their own store on `Scene` (`comments-store.ts`) instead of a new element type: nothing in the
 * element pipeline has to learn that they exist.
 *
 * Both record kinds carry the element envelope — `version`, `versionNonce`, `updated`, `isDeleted`
 * — so they resolve conflicts with the one shared rule (`scene/lww-record.ts`) and never trust
 * wall-clock time across machines. Thread metadata and each message are SEPARATE records: whole-
 * thread last-writer-wins would silently drop one of two concurrent replies, while per-message
 * records union by id so both survive.
 */
import { randomInt } from "../elements/element-factory-defaults";
import { randomVersionNonce } from "../scene/scene-mutations";

/**
 * Where a thread's pin lives.
 *
 * - `element` — pinned to a shape. `fx`/`fy` are the pin's position as a fraction of the element's
 *   UNROTATED local box, so the pin rides move/resize/rotate for free; `x`/`y` record the absolute
 *   scene point that fraction resolved to at creation time and exist purely as the fallback for
 *   when the shape is gone. Resolution is read-time only (`comment-anchor.ts`) — a missing element
 *   NEVER rewrites the stored anchor, so a peer that still has the shape resolves the same thread
 *   against it and the two peers stay converged without a rewrite race.
 * - `point` — a free pin at absolute scene coordinates, belonging to no shape.
 * - `page` — a thread about the board as a whole: no canvas pin, panel only.
 */
export type CommentAnchor =
  | { kind: "element"; elementId: string; fx: number; fy: number; x: number; y: number }
  | { kind: "point"; x: number; y: number }
  | { kind: "page" };

/** Thread metadata. The conversation's messages are separate records keyed by `threadId`. */
export interface CommentThread {
  id: string;
  anchor: CommentAnchor;
  /** Resolved threads keep their pin OUT of the canvas but stay listed in the comments panel. */
  resolved: boolean;
  /** The ephemeral collab identity that opened the thread — not an account; see `comment-author.ts` in the React layer. */
  authorId: string;
  authorName: string;
  created: number;
  version: number;
  versionNonce: number;
  updated: number;
  /** Soft delete, exactly as elements do it — the deletion has to be a record that can win a merge, not an absence. */
  isDeleted: boolean;
}

/** One message in a thread. Its own record, so two peers replying at once both keep their reply. */
export interface CommentMessage {
  id: string;
  threadId: string;
  body: string;
  authorId: string;
  authorName: string;
  created: number;
  version: number;
  versionNonce: number;
  updated: number;
  isDeleted: boolean;
}

/**
 * Hostile-input ceilings, enforced identically by the document reader (`scene-validation.ts`) and
 * the wire validator (`collab-client/comments-adapter.ts`) — generous relative to any real board,
 * so they are abuse guards rather than product limits.
 */
export const MAX_COMMENT_THREADS = 2000;
export const MAX_COMMENT_MESSAGES_PER_THREAD = 500;
/** Total messages a document/store may hold across all threads — the per-thread cap alone would still allow 2000×500. */
export const MAX_COMMENT_MESSAGES = 20_000;
export const MAX_COMMENT_BODY_LENGTH = 4000;
export const MAX_COMMENT_AUTHOR_NAME_LENGTH = 64;

function generateCommentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Same pure-JS fallback the element and layer id generators use, for runtimes without Web Crypto.
  return `${Date.now().toString(36)}-${randomInt().toString(36)}`;
}

export interface CommentThreadCreationInput {
  anchor: CommentAnchor;
  authorId: string;
  authorName: string;
  /** Injected by tests; production callers let it default to `Date.now()`. */
  now?: number;
}

export interface CommentMessageCreationInput {
  threadId: string;
  body: string;
  authorId: string;
  authorName: string;
  now?: number;
}

/**
 * A fresh thread with the pre-insert version sentinel (`version: 0`), mirroring
 * `elements/element-factory-defaults.ts`: the store's `addThread` runs `touchCommentRecord`, which
 * computes `version + 1`, so a record must already carry a numeric version for the first insert to
 * land on `1` rather than `NaN`.
 */
export function createCommentThread(input: CommentThreadCreationInput): CommentThread {
  const created = input.now ?? Date.now();
  return {
    id: generateCommentId(),
    anchor: input.anchor,
    resolved: false,
    authorId: input.authorId,
    authorName: clampAuthorName(input.authorName),
    created,
    version: 0,
    versionNonce: 0,
    updated: 0,
    isDeleted: false,
  };
}

export function createCommentMessage(input: CommentMessageCreationInput): CommentMessage {
  const created = input.now ?? Date.now();
  return {
    id: generateCommentId(),
    threadId: input.threadId,
    body: clampBody(input.body),
    authorId: input.authorId,
    authorName: clampAuthorName(input.authorName),
    created,
    version: 0,
    versionNonce: 0,
    updated: 0,
    isDeleted: false,
  };
}

/**
 * The comment-record equivalent of `scene-mutations.ts`'s `touch()`: applies `changes` and bumps
 * the version envelope in lockstep, returning a frozen copy. Every local mutation in
 * `comments-store.ts` goes through here for the same reason every element mutation goes through
 * `touch()` — a path that forgets to bump would silently corrupt merges rather than fail loudly.
 * Remote adoption deliberately does NOT use this: a winning remote record must land byte-for-byte
 * as its sender produced it, or two peers receiving the same delta would each mint a fresh version
 * and never converge.
 */
export function touchCommentRecord<T extends CommentThread | CommentMessage>(record: T, changes: Partial<T> = {}, now?: number): T {
  const next = {
    ...record,
    ...changes,
    version: record.version + 1,
    versionNonce: randomVersionNonce(),
    updated: now ?? Date.now(),
  } as T;
  return Object.freeze(next);
}

/** Truncates a message body to the cap rather than rejecting it — a paste that is slightly too long should lose its tail, not the user's whole comment. */
export function clampBody(body: string): string {
  return body.length > MAX_COMMENT_BODY_LENGTH ? body.slice(0, MAX_COMMENT_BODY_LENGTH) : body;
}

export function clampAuthorName(name: string): string {
  return name.length > MAX_COMMENT_AUTHOR_NAME_LENGTH ? name.slice(0, MAX_COMMENT_AUTHOR_NAME_LENGTH) : name;
}
