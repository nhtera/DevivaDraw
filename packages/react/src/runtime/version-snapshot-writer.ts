/**
 * How a snapshot lands in the store, and what happens to the store afterwards — the half of version
 * history that deals with a database that can be full.
 *
 * Split from `version-snapshot-scheduler.ts` because the two answer different questions and fail in
 * different ways. The scheduler decides *when* a snapshot is worth taking; this decides whether the
 * store can accept one, makes room when it cannot, and prunes what the policy says should no longer
 * be kept. The scheduler's bookkeeping (when the last snapshot was, at what revision) must advance
 * only on a write that actually landed, which is exactly what this reports back.
 *
 * **Nothing here ever throws.** A snapshot failure is not an autosave failure — they are different
 * promises to the user, and `autosave-status-store.ts` is the one that means "your work is not being
 * saved". Every failure is logged and reported as "did not land".
 */
import { isQuotaExceededError } from "@deviva-draw/engine";
import { DEFAULT_RETENTION_POLICY, snapshotsToPrune } from "../browser/version-retention";
import type { RetentionPolicy } from "../browser/version-retention";
import type { VersionStore } from "../browser/indexeddb-version-store";
import type { VersionSnapshot } from "../browser/version-snapshot-types";

export interface VersionSnapshotWriter {
  /** Stores one snapshot and applies retention. Resolves `true` only when the record actually reached the database. */
  write(snapshot: VersionSnapshot): Promise<boolean>;
  /**
   * `true` once writing has given up for this session — the store refused for quota and making room
   * did not help. Read by the history panel so the user is told history has stopped, rather than
   * being left to notice that it silently stopped growing.
   */
  stopped(): boolean;
}

export function createVersionSnapshotWriter(store: VersionStore, retentionPolicy: RetentionPolicy = DEFAULT_RETENTION_POLICY): VersionSnapshotWriter {
  // Set once the store has refused a write for quota and freeing space did not rescue it. Writing
  // stops for the rest of the session rather than retrying forever against a full disk — a loop of
  // failing multi-megabyte writes is worse for the user than no history.
  let givenUp = false;

  /**
   * Applies the retention policy. Runs after every write that lands, not on a schedule of its own:
   * the store can only grow at a write, so that is the only moment the answer can have changed.
   *
   * A failure here is logged and swallowed. Retention is housekeeping — the snapshot the caller asked
   * for is already safely stored, and reporting that write as failed because the tidying afterwards
   * did not work would be a lie about the thing the caller actually cares about.
   */
  const applyRetention = async (): Promise<void> => {
    try {
      const doomed = snapshotsToPrune(await store.list(), retentionPolicy);
      if (doomed.length > 0) await store.delete(doomed);
    } catch (error) {
      console.warn("deviva-draw: could not apply version-history retention — older versions may be kept longer than intended", error);
    }
  };

  /**
   * Frees the single oldest prunable entry, for the one purpose of making room after a quota
   * rejection. Reports whether anything was actually freed.
   *
   * Sorts by `createdAt` rather than reversing the listing, on the same reasoning `snapshotsToPrune`
   * gives for sorting its own input: this deletes something, and a deletion that silently depended on
   * a caller's ordering would take the wrong end of the history the first time that ordering moved.
   */
  const dropOldestPrunable = async (): Promise<boolean> => {
    try {
      const oldestFirst = [...(await store.list())].sort((left, right) => left.createdAt - right.createdAt);
      const oldest = oldestFirst.find((entry) => entry.trigger !== "manual");
      if (!oldest) return false;
      await store.delete([oldest.id]);
      return true;
    } catch {
      return false;
    }
  };

  return {
    stopped: () => givenUp,

    async write(snapshot) {
      if (givenUp) return false;
      try {
        await store.put(snapshot);
      } catch (error) {
        if (!isQuotaExceededError(error)) {
          console.warn("deviva-draw: could not store a version snapshot — version history may be incomplete", error);
          return false;
        }
        // Out of room. Exactly one attempt to make some and try again: history is the thing that
        // should shrink to fit, and one retry distinguishes "the store was full" from "this document
        // does not fit in this browser", which no amount of pruning fixes.
        if (!(await dropOldestPrunable())) {
          givenUp = true;
          console.warn("deviva-draw: version history is out of storage and has nothing left to prune — no further snapshots this session", error);
          return false;
        }
        try {
          await store.put(snapshot);
        } catch (retryError) {
          givenUp = true;
          console.warn("deviva-draw: version history is out of storage — no further snapshots this session", retryError);
          return false;
        }
      }
      await applyRetention();
      return true;
    },
  };
}
