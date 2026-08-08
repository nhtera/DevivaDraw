/**
 * Observable "which element ids are currently selected" store — the single source of truth
 * `selection-tool.ts` mutates and `render/interactive-layer.ts` (via the host's render loop) reads
 * to draw outlines/handles. Deliberately just an id `Set` plus a change signal (same "no state
 * library needed" reasoning as `scene/scene.ts`'s own pub-sub, see that file's module doc) — it does
 * not itself resolve ids to elements; callers already have a `Scene` for that.
 */
export type SelectionListener = () => void;

export class SelectionState {
  private ids = new Set<string>();
  private readonly listeners = new Set<SelectionListener>();

  getSelectedIds(): ReadonlySet<string> {
    return this.ids;
  }

  isSelected(id: string): boolean {
    return this.ids.has(id);
  }

  get size(): number {
    return this.ids.size;
  }

  /** Replaces the entire selection with exactly `ids` (dedup'd via `Set`). */
  selectOnly(ids: Iterable<string>): void {
    this.ids = new Set(ids);
    this.notify();
  }

  /** Adds `ids` to the current selection without clearing it (shift-click add, marquee union). */
  add(ids: Iterable<string>): void {
    let changed = false;
    for (const id of ids) {
      if (!this.ids.has(id)) {
        this.ids.add(id);
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  /** Flips membership of a single id — shift-click's "toggle" behavior. */
  toggle(id: string): void {
    if (this.ids.has(id)) this.ids.delete(id);
    else this.ids.add(id);
    this.notify();
  }

  remove(ids: Iterable<string>): void {
    let changed = false;
    for (const id of ids) {
      if (this.ids.delete(id)) changed = true;
    }
    if (changed) this.notify();
  }

  clear(): void {
    if (this.ids.size === 0) return;
    this.ids = new Set();
    this.notify();
  }

  subscribe(listener: SelectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
