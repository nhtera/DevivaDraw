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
import type { DeserializeSceneResult, SerializeSceneOptions } from "../persistence/serialize-scene";
import { deserializeScene, serializeScene } from "../persistence/serialize-scene";
import type { SceneDocumentV1 } from "../persistence/scene-schema";
import { indexBetween } from "./fractional-index";
import { liveFileIds, SceneFilesStore } from "./scene-files-store";
import type { StoredFile } from "./scene-files-store";
import { touch } from "./scene-mutations";

export type { StoredFile } from "./scene-files-store";

export type SceneListener = () => void;

/**
 * Runs synchronously inside `updateElement`, right after an element is stored, before that call's
 * own `notify()` dispatch — see `registerUpdateHook`'s doc for why this exists and how it stays safe
 * against re-entrant mutation.
 */
export type SceneUpdateHook = (updated: AnyElement, scene: Scene) => void;

/**
 * Fields callers may change via `updateElement`. `id` is immutable by construction; `type` never
 * changes after creation (a shape doesn't morph into another kind); `version`/`versionNonce`/
 * `updated` are owned exclusively by `touch()` and cannot be set directly, so the bump invariant
 * can't be bypassed by a caller passing its own version number.
 */
export type ElementUpdate = Partial<Omit<AnyElement, "id" | "type" | "version" | "versionNonce" | "updated">>;

export class Scene {
  private readonly elements = new Map<string, AnyElement>();
  /** Binary files (images) referenced by `ImageElement.fileId` — stored separately from `elements` on purpose, see `images/files-map.ts`'s module doc. Composed unit, see `scene-files-store.ts`. */
  private readonly filesStore = new SceneFilesStore();
  private readonly listeners = new Set<SceneListener>();
  /** Domain-specific post-mutation middleware — see `registerUpdateHook`. Empty by default: `Scene` itself knows nothing about bindings, bound text, or any other cross-element relationship. */
  private readonly updateHooks = new Set<SceneUpdateHook>();
  /** True while `notify()` is actively running the listener set — guards against re-entrancy. */
  private notifying = false;
  /** Set when a mutation happens from inside a listener; drained by the outer `notify()` call. */
  private notifyQueued = false;

  /** All elements (including soft-deleted ones), sorted by z-order (`index`, ascending). */
  getElements(): AnyElement[] {
    return [...this.elements.values()].sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
  }

  /**
   * All elements (including soft-deleted ones) in unspecified order — skips the sort `getElements()`
   * pays for on every call. Use this instead of `getElements()` whenever a caller only needs to
   * inspect every element (e.g. summing a per-element field to detect "did anything change") and
   * does not care about z-order.
   */
  elementsUnsorted(): IterableIterator<AnyElement> {
    return this.elements.values();
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

  /**
   * Applies `changes` to the element with `id`, bumps its version/nonce, runs every registered
   * update hook against the result, then notifies subscribers. No-ops if not found.
   *
   * Hooks run *before* `notify()` so a hook-triggered `updateElement` call (e.g. rerouting a bound
   * arrow after its shape moved) is itself a complete, independent `updateElement` invocation —
   * with its own hook pass and its own `notify()` — rather than something the outer call has to
   * wait for or special-case. This is safe from unbounded recursion only because no hook registered
   * in this codebase ever mutates the same element it was invoked for, or an element type that could
   * re-trigger the same hook (see `bindings/binding-scene-sync.ts`'s module doc for the concrete
   * argument); `Scene` itself does not — and cannot, being hook-agnostic — enforce that invariant.
   *
   * A throwing hook can never abort the rest of this method: each hook runs inside its own
   * try/catch (see `runUpdateHooks`), so one bad hook can't stop a later hook from running, can't
   * skip `notify()`, and can't corrupt the mutation that already landed in `this.elements` above.
   */
  updateElement(id: string, changes: ElementUpdate): AnyElement | undefined {
    const existing = this.elements.get(id);
    if (!existing) return undefined;
    const updated = touch(existing, changes);
    this.elements.set(id, updated);
    this.runUpdateHooks(updated);
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

  getFile(fileId: string): StoredFile | undefined {
    return this.filesStore.getFile(fileId);
  }

  hasFile(fileId: string): boolean {
    return this.filesStore.hasFile(fileId);
  }

  /**
   * Registers `file` under `fileId` (a no-op if already present — content-addressed ids mean a
   * duplicate `addFile` for identical bytes is expected, not an error, see `images/files-map.ts`).
   * Notifies subscribers the same as any element mutation, so a static-layer/other consumer redraws
   * once the file backing a soon-to-be-inserted image element actually exists.
   */
  addFile(fileId: string, file: StoredFile): void {
    if (this.filesStore.addFile(fileId, file)) this.notify();
  }

  /**
   * Removes any stored file no longer referenced by a live image element. Deliberately not called
   * automatically from `deleteElement`: like every other soft-delete in this store, a deleted
   * element can still be restored by undo, and an eagerly-pruned file would leave that restored
   * element pointing at nothing. Callers that actually want garbage collection (e.g. before a
   * persistence export) call this explicitly once they're sure no further undo can resurrect the
   * reference. Returns the removed fileIds.
   */
  pruneOrphanedFiles(): string[] {
    const removed = this.filesStore.pruneOrphaned(liveFileIds(this.elements.values()));
    if (removed.length > 0) this.notify();
    return removed;
  }

  /**
   * Inserts `element` exactly as given — no `version`/`versionNonce`/`updated` bump (unlike
   * `addElement`), and no notify of its own beyond whatever the caller triggers afterward. Reserved
   * for `persistence/serialize-scene.ts`'s `deserializeScene`: restoring an already-serialized
   * element must not look like a fresh edit — a freshly-reloaded document should compare identical to
   * the one that was saved, not bump every element's version on every reload. Every other insertion
   * path must go through `addElement`. Throws on a duplicate id, same as `addElement`.
   */
  restoreElement(element: AnyElement): void {
    if (this.elements.has(element.id)) {
      throw new Error(`scene: element with id "${element.id}" already exists; restoreElement is for populating a still-empty scene`);
    }
    this.elements.set(element.id, element);
  }

  /** Registers `file` under `fileId` — see `restoreElement`'s doc; used by the same bulk-restore path in `deserializeScene`. */
  restoreFile(fileId: string, file: StoredFile): void {
    this.filesStore.addFile(fileId, file);
  }

  /** Serializes this scene to the versioned JSON document shape — see `persistence/serialize-scene.ts`'s module doc for the export-vs-autosave `includeDeleted` distinction. */
  toJSON(options?: SerializeSceneOptions): SceneDocumentV1 {
    return serializeScene(this, options);
  }

  /**
   * Parses/validates `raw` and builds a brand-new `Scene` from it, or returns a descriptive error —
   * never throws, and never mutates any existing `Scene` (a `static` factory rather than an instance
   * method, specifically so a malformed load can never partially clobber a live scene the app is
   * already showing). See `persistence/serialize-scene.ts`'s `deserializeScene` for the full contract.
   */
  static fromJSON(raw: unknown): DeserializeSceneResult {
    return deserializeScene(raw);
  }

  /** Registers a change listener; returns an unsubscribe function. */
  subscribe(listener: SceneListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Registers domain-specific middleware that runs on every `updateElement` call — see that
   * method's doc for exact timing/re-entrancy semantics. `Scene` stays framework/domain-agnostic by
   * design (see the module doc): this is how `bindings/binding-scene-sync.ts` wires "reroute bound
   * arrows when their shape moves" and "clear their bindings when it's deleted" into the store
   * without `Scene` itself importing anything binding-specific. Returns an unregister function
   * (same shape as `subscribe`).
   *
   * Error contract: hooks must be idempotent and side-effect-safe to re-run — a throwing hook is
   * caught, logged via `console.error`, and swallowed (never re-thrown to the `updateElement`
   * caller). It does not prevent any other registered hook from running, and it never skips
   * `notify()`. This exists specifically so one buggy/adversarial hook can't silently corrupt a
   * multi-step cascade (e.g. a binding reroute) partway through — every other hook, and every
   * subscriber, still sees a consistent post-mutation `Scene`.
   */
  registerUpdateHook(hook: SceneUpdateHook): () => void {
    this.updateHooks.add(hook);
    return () => this.updateHooks.delete(hook);
  }

  /** Runs every registered update hook against `updated`, isolating each from the others' (and its own) failures — see `registerUpdateHook`'s error contract doc. */
  private runUpdateHooks(updated: AnyElement): void {
    for (const hook of this.updateHooks) {
      try {
        hook(updated, this);
      } catch (error) {
        console.error(`scene: update hook threw for element "${updated.id}" (swallowed; other hooks and notify() still ran):`, error);
      }
    }
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
