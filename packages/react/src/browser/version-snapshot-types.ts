/**
 * The shape of one stored version — the record `indexeddb-version-store.ts` writes and
 * `runtime/version-snapshot-scheduler.ts` produces.
 *
 * Two properties of this type carry the whole feature's safety, and neither is obvious from the
 * field list:
 *
 * 1. **`document` holds no image bytes.** It is exactly what autosave writes — a
 *    `MultiPageDocumentV1` with every image referenced by `fileId` and its pixels living in the
 *    content-addressed file store. Copying the bytes per snapshot would multiply every photograph on
 *    the board by the retention count; the price of not copying is that collection has to be taught
 *    about snapshots (see `runtime/restore-document-files.ts`).
 * 2. **`fileIds` is denormalised.** It is the same set a walk of `document` would produce, recorded
 *    at write time so that neither the panel's listing nor collection's keep-set query ever has to
 *    deserialise a document to answer a question about it. A summary listing that parsed every stored
 *    document would make opening the history panel proportional to the size of every board ever
 *    snapshotted.
 */
import type { MultiPageDocumentV1 } from "@deviva-draw/engine";

/**
 * Why a snapshot exists, which is also what retention is allowed to do with it:
 * - `auto` — the cadence took it; freely prunable.
 * - `manual` — the user asked for it by name; never pruned to make room for an `auto` one.
 * - `milestone` — taken immediately before an operation that replaces the whole document (file open,
 *   room join, clear canvas, another restore), so there is always a way back from a swap the user
 *   cannot undo.
 */
export type SnapshotTrigger = "auto" | "manual" | "milestone";

/**
 * Why a `milestone` snapshot was taken, stored in `label`.
 *
 * A stable code, not prose — the same "code, not prose" contract `CollabErrorReason` follows, and for
 * the same reason: these strings are written to a database and read back by a UI that has to render
 * them in whichever language is active *then*. An English sentence stored here would be an English
 * sentence forever, in a panel that ships two catalogs.
 *
 * `trigger` disambiguates: a manual snapshot's `label` is the user's own text and is never looked up.
 */
export type MilestoneReason = "before-open" | "before-clear" | "before-join" | "before-restore";

/** What the history panel lists — everything except the document itself. Read straight off the stored record; never derived by parsing `document`. */
export interface VersionSummary {
  id: string;
  /** Epoch milliseconds. Supplied by the scheduler's injected clock, never read ambiently here. */
  createdAt: number;
  trigger: SnapshotTrigger;
  /** The user's own name for a `manual` snapshot, or a `MilestoneReason` code for a `milestone` one. Absent for `auto`. */
  label?: string;
  pageCount: number;
  /** Live (non-deleted) elements across every page, for "is this the board I remember?" at a glance. */
  elementCount: number;
  /** Serialised size of `document` in UTF-16 code units — what the byte ceiling in the retention policy is measured against. */
  bytes: number;
}

/** A whole stored version. `VersionSummary` plus the two heavy fields the listing deliberately never reads. */
export interface VersionSnapshot extends VersionSummary {
  document: MultiPageDocumentV1;
  /** Every image this document references. Denormalised at write time — see the module doc. */
  fileIds: string[];
}
