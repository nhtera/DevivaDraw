/**
 * Structural validation for the optional comment arrays of a scene document — the same untrusted-input
 * gate `scene-validation.ts` applies to elements and files, kept in its own module so neither file
 * grows past a readable size.
 *
 * Policy matches the layers list rather than the element list: a corrupt comment entry is DROPPED
 * with a reason, never a reason to reject the whole document. A conversation is metadata attached to
 * a board; losing one malformed thread must never cost the user their drawing.
 *
 * The caps are imported from `comments/comment-types.ts` rather than re-declared as literals here
 * (which is what the layers list does) deliberately: the wire validator in
 * `collab-client/comments-adapter.ts` enforces the same ceilings, and three copies of four numbers
 * is three chances for the document reader and the network reader to disagree about what is legal.
 */
import type { CommentAnchor, CommentMessage, CommentThread } from "../comments/comment-types";
import { clampAuthorName, clampBody, MAX_COMMENT_MESSAGES, MAX_COMMENT_MESSAGES_PER_THREAD, MAX_COMMENT_THREADS } from "../comments/comment-types";

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

/** The version envelope every comment record shares with elements — without all of it the record cannot take part in a merge, so a missing field is fatal to the entry (not to the document). */
function hasValidEnvelope(raw: Record<string, unknown>): boolean {
  return (
    isString(raw.id) &&
    raw.id.length > 0 &&
    isFiniteNumber(raw.version) &&
    isFiniteNumber(raw.versionNonce) &&
    isFiniteNumber(raw.updated) &&
    isBoolean(raw.isDeleted) &&
    isString(raw.authorId) &&
    isString(raw.authorName) &&
    isFiniteNumber(raw.created)
  );
}

/** Validates the anchor union. An unrecognized `kind` is rejected outright rather than coerced — a pin at a guessed position is worse than a dropped thread. */
export function validateCommentAnchor(raw: unknown): CommentAnchor | undefined {
  if (!isPlainObject(raw)) return undefined;
  if (raw.kind === "page") return { kind: "page" };
  if (raw.kind === "point") {
    return isFiniteNumber(raw.x) && isFiniteNumber(raw.y) ? { kind: "point", x: raw.x, y: raw.y } : undefined;
  }
  if (raw.kind === "element") {
    if (!isString(raw.elementId) || raw.elementId.length === 0) return undefined;
    if (!isFiniteNumber(raw.fx) || !isFiniteNumber(raw.fy) || !isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) return undefined;
    return { kind: "element", elementId: raw.elementId, fx: raw.fx, fy: raw.fy, x: raw.x, y: raw.y };
  }
  return undefined;
}

export function validateCommentThread(raw: unknown): CommentThread | undefined {
  if (!isPlainObject(raw) || !hasValidEnvelope(raw) || !isBoolean(raw.resolved)) return undefined;
  const anchor = validateCommentAnchor(raw.anchor);
  if (!anchor) return undefined;
  return {
    id: raw.id as string,
    anchor,
    resolved: raw.resolved,
    authorId: raw.authorId as string,
    authorName: clampAuthorName(raw.authorName as string),
    created: raw.created as number,
    version: raw.version as number,
    versionNonce: raw.versionNonce as number,
    updated: raw.updated as number,
    isDeleted: raw.isDeleted as boolean,
  };
}

export function validateCommentMessage(raw: unknown): CommentMessage | undefined {
  if (!isPlainObject(raw) || !hasValidEnvelope(raw)) return undefined;
  if (!isString(raw.threadId) || raw.threadId.length === 0 || !isString(raw.body)) return undefined;
  return {
    id: raw.id as string,
    threadId: raw.threadId,
    body: clampBody(raw.body),
    authorId: raw.authorId as string,
    authorName: clampAuthorName(raw.authorName as string),
    created: raw.created as number,
    version: raw.version as number,
    versionNonce: raw.versionNonce as number,
    updated: raw.updated as number,
    isDeleted: raw.isDeleted as boolean,
  };
}

export interface CommentValidationResult {
  threads: CommentThread[] | undefined;
  messages: CommentMessage[] | undefined;
  /** One human-readable reason per dropped entry — surfaced by the lenient path's report, and a hard failure on the strict one (matching how the layers list is handled). */
  errors: string[];
}

/**
 * Validates both comment arrays together, because their caps interact: the per-thread message
 * ceiling can only be enforced once the messages are grouped. Duplicate ids are dropped keep-first,
 * as in the layers list. Absent arrays validate to `undefined` — the "no comments" document.
 */
export function validateCommentRecords(rawThreads: unknown, rawMessages: unknown): CommentValidationResult {
  const errors: string[] = [];
  const threads = validateRecordList(rawThreads, "comments", MAX_COMMENT_THREADS, validateCommentThread, errors);
  const messages = validateRecordList(rawMessages, "commentMessages", MAX_COMMENT_MESSAGES, validateCommentMessage, errors);

  let capped = messages;
  if (messages) {
    const perThread = new Map<string, number>();
    capped = messages.filter((message) => {
      const count = perThread.get(message.threadId) ?? 0;
      if (count >= MAX_COMMENT_MESSAGES_PER_THREAD) {
        errors.push(`commentMessages for thread "${message.threadId}" exceed the ${MAX_COMMENT_MESSAGES_PER_THREAD}-message cap (kept the first)`);
        return false;
      }
      perThread.set(message.threadId, count + 1);
      return true;
    });
  }

  return { threads, messages: capped && capped.length > 0 ? capped : undefined, errors };
}

function validateRecordList<T extends { id: string }>(
  raw: unknown,
  field: string,
  cap: number,
  validate: (entry: unknown) => T | undefined,
  errors: string[],
): T[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    errors.push(`scene document "${field}" must be an array when present`);
    return undefined;
  }
  if (raw.length > cap) errors.push(`scene document "${field}" exceeds the ${cap}-entry cap (extra entries dropped)`);

  const seen = new Set<string>();
  const records: T[] = [];
  for (const [index, entry] of raw.slice(0, cap).entries()) {
    const record = validate(entry);
    if (!record) {
      errors.push(`${field}[${index}] is not a valid comment record`);
      continue;
    }
    if (seen.has(record.id)) {
      errors.push(`${field}[${index}] duplicates id "${record.id}" (kept the first)`);
      continue;
    }
    seen.add(record.id);
    records.push(record);
  }
  return records.length > 0 ? records : undefined;
}
