/**
 * The history panel's state: what versions exist, and the operations on them.
 *
 * Everything here is a thin, honest wrapper — the decisions live in the modules underneath
 * (`restore-version-snapshot.ts` owns the guard and the ordering, `version-snapshot-writer.ts` owns
 * retention, `indexeddb-version-store.ts` owns storage). What this adds is the React-shaped part: a
 * list that re-reads when something changes it, and a loading state honest enough that the panel
 * never claims "no versions yet" while it is still asking.
 *
 * Not unit tested, for the reason every hook in this package documents (no `@testing-library/react`
 * — see `runtime/use-live-version.ts`): there is no decision logic left here to test. What matters is
 * tested where it lives, and end to end in `apps/web/e2e/version-history.spec.ts`.
 */
import { useCallback, useEffect, useState } from "react";
import type { FileStoreLike } from "@deviva-draw/engine";
import { restoreVersionSnapshot } from "../browser/restore-version-snapshot";
import type { RestoreVersionOutcome } from "../browser/restore-version-snapshot";
import { renderVersionThumbnail } from "../browser/version-snapshot-preview";
import type { VersionStore } from "../browser/indexeddb-version-store";
import type { VersionSummary } from "../browser/version-snapshot-types";
import type { VersionSnapshotScheduler } from "../runtime/version-snapshot-scheduler";
import type { PageStore } from "../pages/page-store";

export interface UseVersionHistoryOptions {
  /** Only reads the store while this is `true` — a panel nobody has opened should not be querying a database. */
  open: boolean;
  getVersionStore(): VersionStore | null;
  getVersionScheduler(): VersionSnapshotScheduler | null;
  getFileStore(): FileStoreLike | null;
  /** Releases the image bytes a deleted version was keeping alive. See `UseDevivaRuntimeResult.collectUnusedFiles`. */
  collectUnusedFiles(): Promise<void>;
  pageStore: PageStore;
  /** `true` while a room session is connected **or connecting** — see `restore-version-snapshot.ts`. */
  isSessionActive(): boolean;
  /** Called after a restore lands: flush autosave, repaint. */
  onRestored(): void;
}

export interface UseVersionHistoryResult {
  /** `false` where there is no version history in this session at all — no IndexedDB, or a host managing its own persistence. The menu says so rather than opening an empty panel. */
  available: boolean;
  /** `true` once snapshotting has given up for the session (the store is full) — see `VersionSnapshotScheduler.stopped`. */
  stopped: boolean;
  /** `true` until the first listing has come back, so an empty list is never shown as "there is nothing here" while the answer is still on its way. */
  loading: boolean;
  versions: VersionSummary[];
  refresh(): void;
  saveVersion(label: string): Promise<void>;
  restore(id: string): Promise<RestoreVersionOutcome>;
  remove(id: string): Promise<void>;
  clearAll(): Promise<void>;
  /** A PNG data URL for one version, or `null` when it cannot be rendered. */
  preview(id: string): Promise<string | null>;
}

export function useVersionHistory(options: UseVersionHistoryOptions): UseVersionHistoryResult {
  const { open, getVersionStore, getVersionScheduler, getFileStore, collectUnusedFiles, pageStore, isSessionActive, onRestored } = options;
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  // Bumped by every operation that changes the store, which is what re-runs the listing effect below.
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const store = getVersionStore();
    if (!store) {
      setVersions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void store
      .list()
      .then((listed) => {
        if (!cancelled) setVersions(listed);
      })
      .catch((error: unknown) => {
        console.warn("deviva-draw: could not read version history", error);
        if (!cancelled) setVersions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, revision, getVersionStore]);

  const saveVersion = useCallback(
    async (label: string) => {
      await getVersionScheduler()?.snapshotNow("manual", label);
      refresh();
    },
    [getVersionScheduler, refresh],
  );

  const restore = useCallback(
    async (id: string): Promise<RestoreVersionOutcome> => {
      const outcome = await restoreVersionSnapshot(id, {
        versionStore: getVersionStore(),
        fileStore: getFileStore(),
        pageStore,
        isSessionActive,
        // The "before restore" milestone — the user's way back from a restore they did not mean.
        snapshotBeforeRestore: async () => {
          await getVersionScheduler()?.snapshotNow("milestone", "before-restore");
        },
        onRestored,
      });
      // Refreshed on success only: a refusal changed nothing, and re-listing would be busywork that
      // makes the panel flicker for no reason.
      if (outcome.ok) refresh();
      return outcome;
    },
    [getVersionStore, getFileStore, getVersionScheduler, pageStore, isSessionActive, onRestored, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await getVersionStore()?.delete([id]);
      refresh();
      // Deleting the record does not release the image bytes it was protecting — collection does,
      // once nothing points at them any more.
      await collectUnusedFiles();
    },
    [getVersionStore, collectUnusedFiles, refresh],
  );

  const clearAll = useCallback(async () => {
    await getVersionStore()?.clearAll();
    refresh();
    await collectUnusedFiles();
  }, [getVersionStore, collectUnusedFiles, refresh]);

  const preview = useCallback(
    async (id: string) => {
      const snapshot = await getVersionStore()?.get(id);
      if (!snapshot) return null;
      return renderVersionThumbnail(snapshot, getFileStore());
    },
    [getVersionStore, getFileStore],
  );

  return {
    available: getVersionStore() !== null,
    stopped: getVersionScheduler()?.stopped() ?? false,
    loading,
    versions,
    refresh,
    saveVersion,
    restore,
    remove,
    clearAll,
    preview,
  };
}
