/**
 * Putting a stored version back on screen, and refusing to when that would do damage.
 *
 * A plain async function over injected dependencies rather than logic inside the panel, for two
 * reasons that are really one: **the guard lives here**. Restore replaces the entire document, and
 * the states in which that is unsafe (a live collaboration session, a join still connecting) are not
 * things a future entry point — a keyboard shortcut, a command-palette action, a native menu item —
 * can be trusted to remember to check. A caller cannot restore without going through this, so a
 * caller cannot skip the guard.
 *
 * The order of the steps is the other half. Every failure mode this can have is a failure *before*
 * anything is touched: the guard first, then the record read and fully validated, and only then the
 * document swapped. A malformed record must leave the open board exactly as it was, rather than
 * emptying it and then discovering there is nothing to put in its place.
 */
import { deserializeMultiPageDocument } from "@deviva-draw/engine";
import type { FileStoreLike, ScenePage } from "@deviva-draw/engine";
import { restoreSceneFiles } from "../runtime/restore-document-files";
import type { VersionStore } from "./indexeddb-version-store";
import type { PageStore } from "../pages/page-store";

/**
 * Why a restore did not happen, as a code rather than prose — the same contract `CollabErrorReason`
 * follows, so the panel picks an i18n'd message instead of displaying a sentence baked in here.
 */
export type RestoreRefusedReason =
  /** A session is connected, or a join is still in flight. */
  | "in-session"
  /** No such version — deleted by retention, or by another tab, between listing and clicking. */
  | "not-found"
  /** The record is there but will not deserialise. Nothing was changed. */
  | "unreadable"
  /** There is no version history in this session at all. */
  | "unavailable";

export type RestoreVersionOutcome = { ok: true; pageCount: number } | { ok: false; reason: RestoreRefusedReason };

export interface RestoreVersionDeps {
  /** `null` where version history never opened — restore is simply not a thing that can happen. */
  versionStore: VersionStore | null;
  /** Where the restored document's images are read back from. `null` degrades to a board whose images cannot be rehydrated, which is still better than refusing the restore outright. */
  fileStore: FileStoreLike | null;
  pageStore: PageStore;
  /**
   * `true` while a room session is connected **or connecting**. Read at the moment of the attempt,
   * never from a captured value: the connecting window is exactly the case a stale read misses.
   */
  isSessionActive(): boolean;
  /**
   * Takes the "before restore" milestone. Awaited, so the way back exists before the way forward is
   * taken — a restore whose own undo record was still being written when it replaced the board would
   * be a restore the user cannot walk back from if anything then goes wrong.
   */
  snapshotBeforeRestore(): Promise<unknown>;
  /** Called once the new document and its images are in place — flush autosave, repaint. */
  onRestored(): void;
}

export async function restoreVersionSnapshot(id: string, deps: RestoreVersionDeps): Promise<RestoreVersionOutcome> {
  const { versionStore, fileStore, pageStore, isSessionActive, snapshotBeforeRestore, onRestored } = deps;

  if (!versionStore) return { ok: false, reason: "unavailable" };
  // First, before anything is read or written. Replaying a whole-document replacement into a room is
  // the shape of the 0.11.1–0.11.3 data-loss bugs, and during a join it is worse still: the page list
  // changes underneath `adoptRoomPages`, whose deliberately strict "untouched" check then fails
  // silently, leaving the restored document and the room's merged pages coexisting with no error
  // anywhere.
  if (isSessionActive()) return { ok: false, reason: "in-session" };

  const snapshot = await versionStore.get(id);
  if (!snapshot) return { ok: false, reason: "not-found" };

  // Validated in full while the open document is still untouched. `deserializeMultiPageDocument` is
  // the strict reader, not the lenient one: a version restored with entries silently dropped would be
  // a version that is not what the user is looking at in the preview.
  const document = deserializeMultiPageDocument(snapshot.document);
  if (!document.ok) {
    console.warn(`deviva-draw: could not restore this version — ${document.error}`);
    return { ok: false, reason: "unreadable" };
  }

  await snapshotBeforeRestore();

  const pages: ScenePage[] = document.pages;
  pageStore.replaceAll(pages, document.activePageId);
  // Files only, never collection: this is mid-session, so the document that was on screen a moment
  // ago is still one undo — and one restore of the "before restore" milestone — away from mattering.
  if (fileStore) {
    await restoreSceneFiles(
      pages.map((page) => page.scene),
      fileStore,
    );
  }
  onRestored();
  return { ok: true, pageCount: pages.length };
}
