/**
 * The untrusted-wire boundary for comment records — the comments sibling of `lww-merge.ts`, holding
 * both halves of the same job for the same reason that module does: "decide" and "apply" stay atomic
 * from a caller's perspective, with no window where a second concurrent inbound delta could act on a
 * stale comparison.
 *
 * Two deliberate differences from `layers-adapter.ts`'s `isPlausibleLayersManifest`:
 *
 * 1. These functions SANITIZE rather than merely assert. A type guard hands the caller back the exact
 *    object that arrived, so an over-long body from a hostile peer would pass the check and then land
 *    in the store at full length. Returning a rebuilt, clamped record closes that by construction.
 * 2. The shape rules and caps are the engine's own document validators, reused verbatim. A comment
 *    that is legal in a `.devivadraw` file and one that is legal on the wire must be the same thing;
 *    two hand-kept copies of those rules is how a peer ends up able to write a record that no one
 *    can reload.
 *
 * The record still travels as an opaque `{type, iv, ciphertext}` envelope: the relay never sees any
 * of this, and `comment-delta` is one more type string in its whitelist, nothing more.
 */
import type { CommentMessage, CommentThread, Scene } from "@deviva-draw/engine";
import { lwwRecordWins, validateCommentMessage, validateCommentThread } from "@deviva-draw/engine";

/** A decrypted payload rebuilt into a safe `CommentThread`, or `undefined` when it is not one. */
export function parseRemoteCommentThread(value: unknown): CommentThread | undefined {
  return validateCommentThread(value);
}

export function parseRemoteCommentMessage(value: unknown): CommentMessage | undefined {
  return validateCommentMessage(value);
}

/**
 * Validates, LWW-compares, and applies one remote thread record. Returns whether it was actually
 * applied — the caller uses that to skip a redundant notify or a pointless rebroadcast of a delta
 * that changed nothing.
 */
export function mergeRemoteCommentThread(scene: Scene, raw: unknown): CommentThread | null {
  const thread = parseRemoteCommentThread(raw);
  if (!thread) return null;
  if (!lwwRecordWins(scene.getCommentThread(thread.id), thread)) return null;
  return scene.applyRemoteCommentThread(thread) ? thread : null;
}

export function mergeRemoteCommentMessage(scene: Scene, raw: unknown): CommentMessage | null {
  const message = parseRemoteCommentMessage(raw);
  if (!message) return null;
  if (!lwwRecordWins(scene.getCommentMessage(message.id), message)) return null;
  return scene.applyRemoteCommentMessage(message) ? message : null;
}

/** Merges a snapshot's comment arrays into `scene`, reporting each record that was adopted so the caller can mark it synced and avoid echoing it straight back. */
export function mergeRemoteComments(scene: Scene, rawThreads: unknown, rawMessages: unknown): { threads: CommentThread[]; messages: CommentMessage[] } {
  const threads: CommentThread[] = [];
  const messages: CommentMessage[] = [];
  if (Array.isArray(rawThreads)) {
    for (const raw of rawThreads) {
      const applied = mergeRemoteCommentThread(scene, raw);
      if (applied) threads.push(applied);
    }
  }
  if (Array.isArray(rawMessages)) {
    for (const raw of rawMessages) {
      const applied = mergeRemoteCommentMessage(scene, raw);
      if (applied) messages.push(applied);
    }
  }
  return { threads, messages };
}
