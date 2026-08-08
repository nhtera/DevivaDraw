/**
 * In-memory scene store: the single source of truth every tool, renderer, and (eventually)
 * collab client reads and writes. Framework-agnostic on purpose — no React here — so
 * `apps/collab-server` can reason about the same element shape for last-writer-wins merge
 * without ever importing a UI framework. `packages/react` wraps this in hooks separately.
 *
 * Pub-sub is a plain `Set` of callbacks, not a state library: the store's job is CRUD plus a
 * change signal, nothing a dependency would meaningfully simplify (YAGNI).
 */
import type { AnyElement } from "../elements/element-types";
import { indexBetween } from "./fractional-index";
import { touch } from "./scene-mutations";

export type SceneListener = () => void;

/**
 * Fields callers may change via `updateElement`. `id` is immutable by construction; `type` never
 * changes after creation (a shape doesn't morph into another kind); `version`/`versionNonce`/
 * `updated` are owned exclusively by `touch()` and cannot be set directly, so the bump invariant
 * can't be bypassed by a caller passing its own version number.
 */
export type ElementUpdate = Partial<Omit<AnyElement, "id" | "type" | "version" | "versionNonce" | "updated">>;

export class Scene {
  private readonly elements = new Map<string, AnyElement>();
  private readonly listeners = new Set<SceneListener>();
  /** True while `notify()` is actively running the listener set — guards against re-entrancy. */
  private notifying = false;
  /** Set when a mutation happens from inside a listener; drained by the outer `notify()` call. */
  private notifyQueued = false;

  /** All elements (including soft-deleted ones), sorted by z-order (`index`, ascending). */
  getElements(): AnyElement[] {
    return [...this.elements.values()].sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
  }

  getElement(id: string): AnyElement | undefined {
    return this.elements.get(id);
  }

  /**
   * Inserts a newly created element (see `elements/element-types.ts` factories) into the scene.
   * Assigns it a z-order index after the current last element unless the caller already set one,
   * then runs it through `touch()` so a freshly-added element still has `version === 1` rather
   * than the `0` sentinel the factory left it at — insertion is itself a mutation.
   *
   * Throws on a duplicate id rather than silently overwriting: id collisions never happen in the
   * normal create-then-add flow (factories mint fresh ids), so one occurring means either a bug
   * upstream or a remote peer's element arriving through this same path — and a remote element
   * must go through an explicit last-writer-wins comparison, never a blind overwrite of local
   * edits. That merge path is added when collaboration lands; until then, this throw is the
   * correct behavior, not a placeholder for it.
   */
  addElement(element: AnyElement): AnyElement {
    if (this.elements.has(element.id)) {
      throw new Error(`scene: element with id "${element.id}" already exists; use updateElement to modify it`);
    }
    const index = element.index || indexBetween(this.lastIndex(), null);
    const stored = touch(element, { index });
    this.elements.set(stored.id, stored);
    this.notify();
    return stored;
  }

  /** Applies `changes` to the element with `id` and bumps its version/nonce. No-ops if not found. */
  updateElement(id: string, changes: ElementUpdate): AnyElement | undefined {
    const existing = this.elements.get(id);
    if (!existing) return undefined;
    const updated = touch(existing, changes);
    this.elements.set(id, updated);
    this.notify();
    return updated;
  }

  /**
   * Soft-deletes: sets `isDeleted` rather than removing the element from the map. Required so
   * undo can restore a delete without reconstructing the element, and so a later remote merge of
   * a concurrent edit to the same element can't resurrect stale data by simply not knowing it was
   * deleted. Consumers that render or export the scene are responsible for filtering `isDeleted`
   * elements out — this store never purges them.
   */
  deleteElement(id: string): AnyElement | undefined {
    return this.updateElement(id, { isDeleted: true });
  }

  /** Registers a change listener; returns an unsubscribe function. */
  subscribe(listener: SceneListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Dispatches the change signal to every subscriber. Listeners are allowed to mutate the scene
   * (an autosave listener persisting a debounced snapshot, a collab listener echoing a remote
   * change back through a derived element, ...); without a re-entrancy guard, such a mutation
   * would call `notify()` again from inside this same dispatch and recurse through the whole
   * listener set on every nested mutation, unbounded by anything but the JS call stack.
   *
   * Instead, a mutation that happens while already dispatching just sets `notifyQueued` and
   * returns immediately — no nested dispatch, no stack growth. Once the in-flight dispatch
   * finishes its pass over `listeners`, the `do/while` below checks the flag and runs one more
   * pass to deliver the queued mutation(s), coalescing any number of them into a single extra
   * pass rather than one per mutation.
   */
  private notify(): void {
    if (this.notifying) {
      this.notifyQueued = true;
      return;
    }
    this.notifying = true;
    try {
      do {
        this.notifyQueued = false;
        for (const listener of this.listeners) listener();
      } while (this.notifyQueued);
    } finally {
      this.notifying = false;
    }
  }

  private lastIndex(): string | null {
    const elements = this.getElements();
    const last = elements.at(-1);
    return last ? last.index : null;
  }
}
