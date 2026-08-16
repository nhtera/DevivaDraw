/**
 * The document's file identity + dirty flag, tracked SYNCHRONOUSLY and by CONTENT only — the
 * desktop shell's title bar, macOS documentEdited dot, and unsaved-close guard all read this.
 * Deliberately not derived from the autosave trigger set: autosave debounces (dirty must be true
 * the instant an edit lands — that gap is the crash window) and autosave schedules on camera moves
 * (a look-only session must close without an unsaved prompt). The wiring in `use-deviva-runtime`
 * decides WHAT counts as content (scene mutations + page-list content revisions, never
 * `setActivePage`/camera); this class only holds the revision arithmetic so it stays unit-testable.
 */

export interface DocumentState {
  /** The open file's real path, or `null` for an unsaved/scratch document (and always in path-less browser hosts). */
  path: string | null;
  /** Display name — the file's basename, or "Untitled" before any open/save. */
  name: string;
  /** `true` iff content changed since the last successful open/save. */
  dirty: boolean;
}

export interface DocumentFileIdentity {
  path: string | null;
  name: string;
}

const UNTITLED = "Untitled";

export class DocumentStateTracker {
  private revision = 0;
  private savedRevision = 0;
  private identity: DocumentFileIdentity | null = null;
  private readonly listeners = new Set<() => void>();

  /** A content edit landed (scene mutation or page-list content change). Synchronous — no debounce. */
  markContentChanged(): void {
    this.revision += 1;
    this.notify();
  }

  /**
   * A successful open or save established (or refreshed) the file identity — the document is clean
   * as of right now. A FAILED save must not call this: dirty state survives failures by design.
   */
  markSaved(identity: DocumentFileIdentity): void {
    this.identity = identity;
    this.savedRevision = this.revision;
    this.notify();
  }

  getState(): DocumentState {
    return {
      path: this.identity?.path ?? null,
      name: this.identity?.name ?? UNTITLED,
      dirty: this.revision !== this.savedRevision,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
