/**
 * Whether autosave is currently able to save at all — the state behind the storage-full warning.
 *
 * A failed autosave write is the one editor failure the user cannot see: the board keeps taking
 * edits, the canvas looks healthy, and the work is gone at the next reload. The engine's writers
 * already report each write's outcome (`AutosaveWriteCallbacks`); this store is the thin, pub-sub
 * memory of the latest one, so chrome can subscribe to it the way `camera-store.ts` lets chrome
 * subscribe to pan/zoom — no polling, no per-render recompute.
 *
 * Deliberately a *latch on the last outcome*, not a counter or a history: the only question the UI
 * asks is "is saving working right now", and the only two answers that matter are the current one.
 * A recovered write (the user freed space, or deleted the huge image) clears the warning by itself,
 * which is why the engine reports successes at all.
 */

export type AutosaveStatus = "ok" | "quota-exceeded";

export type AutosaveStatusListener = () => void;

export interface AutosaveStatusStore {
  getStatus(): AutosaveStatus;
  /** Records a write that landed — clears a standing quota warning. */
  markWritten(): void;
  /** Records a write rejected for want of storage space. */
  markQuotaExceeded(): void;
  /** Fires whenever the status actually changes; returns an unsubscribe function. */
  subscribe(listener: AutosaveStatusListener): () => void;
}

export function createAutosaveStatusStore(): AutosaveStatusStore {
  let status: AutosaveStatus = "ok";
  const listeners = new Set<AutosaveStatusListener>();

  // Only an actual transition notifies: autosave writes once per quiet period for the whole session,
  // so a store that re-notified on every successful write would re-render the chrome forever.
  const set = (next: AutosaveStatus) => {
    if (next === status) return;
    status = next;
    for (const listener of listeners) listener();
  };

  return {
    getStatus: () => status,
    markWritten: () => set("ok"),
    markQuotaExceeded: () => set("quota-exceeded"),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
