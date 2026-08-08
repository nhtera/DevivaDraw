/**
 * Undo/redo history: a linear list of snapshots with a cursor, not two independent stacks — a
 * single list makes "discard the redo branch on a fresh edit" a one-line slice instead of a
 * separately-maintained invariant between two collections.
 *
 * Generic over the snapshot type `T` so it has no dependency on `Scene`: callers decide what a
 * "snapshot" is (typically the scene's element array). This keeps the engine's history primitive
 * reusable for any state shape, not just elements.
 *
 * Gesture grouping ("one drag = one undo step", Excalidraw-style) works by having `beginBatch()`
 * simply suppress `push()` until `endBatch()` commits the post-gesture snapshot. No intermediate
 * state during the batch is ever recorded, so `undo()` after a batch always restores exactly the
 * pre-gesture state (the entry committed before the batch began) — the input layer (a later
 * phase) calls `beginBatch()` on gesture start and `endBatch()` on gesture end, explicitly, never
 * via an implicit timer.
 */

export interface HistoryStackOptions {
  /**
   * Maximum number of snapshots retained in `history` (the current state plus its past states
   * combined) — not the count of `undo()` calls available, which is one less than this once the
   * cap is reached (the current state occupies one slot). Oldest entries are dropped once exceeded.
   */
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 100;

export class HistoryStack<T> {
  private readonly maxDepth: number;
  private history: T[];
  /** Index into `history` of the currently-applied snapshot. */
  private cursor = 0;
  private batchOpen = false;

  constructor(initial: T, options: HistoryStackOptions = {}) {
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.history = [initial];
  }

  /** Starts a gesture. Nested/repeated calls before `endBatch()` are no-ops. */
  beginBatch(): void {
    this.batchOpen = true;
  }

  /** Ends the gesture and commits `snapshot` as the single undo step for the whole batch. */
  endBatch(snapshot: T): void {
    if (!this.batchOpen) return;
    this.batchOpen = false;
    this.commit(snapshot);
  }

  /**
   * Discards an open batch without recording anything. Required for gestures that get abandoned
   * rather than completed — Escape mid-drag, a pointer-cancel event, a tool switch mid-gesture —
   * where there is no meaningful "final" snapshot to pass to `endBatch()`. Without this, an
   * abandoned `beginBatch()` leaves `batchOpen` stuck `true` forever, and every subsequent
   * `push()` for the rest of the session is silently swallowed. No-op if no batch is open.
   */
  cancelBatch(): void {
    this.batchOpen = false;
  }

  /** True between a `beginBatch()` call and the matching `endBatch()`/`cancelBatch()`. */
  isBatchOpen(): boolean {
    return this.batchOpen;
  }

  /** Records `snapshot` as one undo step. Ignored while a batch is open — the batch owns the step. */
  push(snapshot: T): void {
    if (this.batchOpen) return;
    this.commit(snapshot);
  }

  /** Moves the cursor back one step and returns the snapshot to restore, or `undefined` at the start. */
  undo(): T | undefined {
    if (this.cursor === 0) return undefined;
    this.cursor -= 1;
    return this.at(this.cursor);
  }

  /** Moves the cursor forward one step and returns the snapshot to restore, or `undefined` at the end. */
  redo(): T | undefined {
    if (this.cursor >= this.history.length - 1) return undefined;
    this.cursor += 1;
    return this.at(this.cursor);
  }

  canUndo(): boolean {
    return this.cursor > 0;
  }

  canRedo(): boolean {
    return this.cursor < this.history.length - 1;
  }

  private commit(snapshot: T): void {
    // A fresh edit after undo() invalidates whatever redo branch existed past the cursor.
    this.history = this.history.slice(0, this.cursor + 1);
    this.history.push(snapshot);
    this.cursor += 1;

    if (this.history.length > this.maxDepth) {
      const overflow = this.history.length - this.maxDepth;
      this.history = this.history.slice(overflow);
      this.cursor -= overflow;
    }
  }

  /** Indexed read with the store's own bounds invariant, not a possibly-`undefined` array access. */
  private at(index: number): T {
    const snapshot = this.history[index];
    if (snapshot === undefined) {
      throw new Error(`history-stack: no snapshot at index ${index} (history length ${this.history.length})`);
    }
    return snapshot;
  }
}
