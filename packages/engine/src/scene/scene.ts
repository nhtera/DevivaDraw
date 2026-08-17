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
import { compareIndexedItems, indexBetween } from "./fractional-index";
import { liveFileIds, SceneFilesStore } from "./scene-files-store";
import type { StoredFile } from "./scene-files-store";
import { SceneLayersStore } from "./scene-layers";
import type { LayersManifest, SceneLayer } from "./scene-layers";
import { freezeElement, touch } from "./scene-mutations";

export type { StoredFile } from "./scene-files-store";
export type { SceneLayer } from "./scene-layers";

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

/**
 * The observable element store at the heart of the engine: elements in fractional-index z-order,
 * stored files (images), layers, and a change-notification surface every Deviva Draw host
 * (React shell, desktop app, MCP server, collab merge) builds on.
 *
 * @example
 * ```ts
 * import { Scene, createRectangleElement } from "@deviva-draw/engine";
 *
 * const scene = new Scene();
 * const box = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 160, height: 80 }));
 * scene.updateElement(box.id, { backgroundColor: "#ffec99" });
 * const doc = scene.toJSON(); // persist anywhere; reload with Scene.fromJSON(doc)
 * ```
 */
export class Scene {
  private readonly elements = new Map<string, AnyElement>();
  /** Binary files (images) referenced by `ImageElement.fileId` — stored separately from `elements` on purpose, see `images/files-map.ts`'s module doc. Composed unit, see `scene-files-store.ts`. */
  private readonly filesStore = new SceneFilesStore();
  /** Ordered layer list, self-initialized with one default layer — see `scene-layers.ts`'s module doc for the hard zero-arg-constructor invariant every `new Scene()` site relies on. */
  private readonly layersStore = new SceneLayersStore();
  private readonly listeners = new Set<SceneListener>();
  /** Domain-specific post-mutation middleware — see `registerUpdateHook`. Empty by default: `Scene` itself knows nothing about bindings, bound text, or any other cross-element relationship. */
  private readonly updateHooks = new Set<SceneUpdateHook>();
  /** True while `notify()` is actively running the listener set — guards against re-entrancy. */
  private notifying = false;
  /** True while a `batch()` is open — `notify()` records the intent and defers, see `batch`. */
  private batching = false;
  /** Set when a mutation happened inside an open batch, so the batch knows to notify on exit. */
  private batchPending = false;
  /** Set when a mutation happens from inside a listener; drained by the outer `notify()` call. */
  private notifyQueued = false;
  /**
   * Document-level canvas background color, or `null` to fall back to the theme's default. A scene
   * setting (not a per-element field), so it lives on the store and rides the same `toJSON`/`fromJSON`
   * persistence path every save/autosave/share already uses — no separate wiring per surface.
   */
  private background: string | null = null;

  /**
   * All elements (including soft-deleted ones), sorted by z-order: layer position first (bottom
   * layer paints first), then the fractional `index` within a layer (ascending, `id` as a
   * deterministic tiebreak — see `fractional-index.ts`'s `compareIndexedItems` doc). A scene whose
   * elements all live on one layer sorts identically to the pre-layers comparator, which is what
   * keeps every legacy document's draw order bit-stable.
   */
  getElements(): AnyElement[] {
    return [...this.elements.values()].sort((a, b) => {
      const layerDelta = this.layersStore.positionOf(a.layerId) - this.layersStore.positionOf(b.layerId);
      return layerDelta !== 0 ? layerDelta : compareIndexedItems(a, b);
    });
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
    // Stamp membership only when the active layer isn't the default one — default-layer elements
    // stay unstamped by convention (see `scene-layers.ts`), keeping untouched scenes wire-identical
    // to pre-layers builds. An element arriving with its own layerId (a cross-layer paste, the
    // draw-to-shape replacement carrying its stroke's layer) keeps it.
    const activeId = this.layersStore.getActiveLayerId();
    const stampLayer = element.layerId === undefined && activeId !== this.layersStore.getDefaultLayerId();
    const stored = touch(element, stampLayer ? { index, layerId: activeId } : { index });
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

  /**
   * Replaces every element with exactly `elements`, in one atomic swap plus a single `notify()` — the
   * undo/redo restore path: `HistoryStack<AnyElement[]>` snapshots (`scene.getElements()`) taken by
   * tool gestures are handed straight back here by the UI-chrome layer's undo/redo action, with no
   * `version`/`versionNonce`/`updated` bump (like `restoreElement`, not `addElement`/`updateElement`) —
   * an undo must restore an element to its exact prior recorded state, not mint a fresh "edit" on top
   * of it. Files are left untouched: undoing an image insert removes the `ImageElement` referencing it
   * but intentionally leaves the file bytes in `filesStore` (same "no eager GC, only explicit
   * `pruneOrphanedFiles()`" policy `deleteElement`'s doc already documents) so a redo immediately after
   * finds the file still there.
   */
  loadElementsSnapshot(elements: readonly AnyElement[]): void {
    this.elements.clear();
    for (const element of elements) this.elements.set(element.id, element);
    this.notify();
  }

  /** Current document-level canvas background color, or `null` when it should fall back to the theme default. */
  getBackground(): string | null {
    return this.background;
  }

  /** Sets (or clears, via `null`) the canvas background color and signals subscribers — so the host repaints and autosave persists it, the same as any element change. */
  setBackground(color: string | null): void {
    if (this.background === color) return;
    this.background = color;
    this.notify();
  }

  // ---- Layers ----------------------------------------------------------------------------------
  // Thin, notifying facades over `SceneLayersStore` (which never notifies itself — the Scene owns
  // the change signal, same as for files). Layer-LIST mutations are deliberately NOT part of undo
  // history (the canvas-background precedent); element MEMBERSHIP (`layerId`) is an ordinary
  // element field and rides history snapshots like any other.

  /** Bottom→top layer list (copies). Always ≥1. */
  getLayers(): SceneLayer[] {
    return this.layersStore.getLayers();
  }

  getLayer(id: string): SceneLayer | undefined {
    return this.layersStore.getLayer(id);
  }

  getDefaultLayerId(): string {
    return this.layersStore.getDefaultLayerId();
  }

  getActiveLayerId(): string {
    return this.layersStore.getActiveLayerId();
  }

  /** Where `element` effectively lives — `undefined`/orphaned membership resolves to the default layer at read time, never by rewriting the element. */
  resolveLayer(element: Pick<AnyElement, "layerId">): SceneLayer {
    return this.layersStore.resolve(element.layerId);
  }

  /** True when the element's layer is hidden — the single source every render/hit/export/search surface consults. Hidden is a VIEW state: the element's own data (incl. `isDeleted`) is untouched. */
  isElementHidden(element: Pick<AnyElement, "layerId">): boolean {
    return !this.layersStore.resolve(element.layerId).visible;
  }

  /** Element-level `locked` OR its layer's lock — layer-locked elements must behave exactly like individually-locked ones on every interaction surface. */
  effectiveLocked(element: Pick<AnyElement, "layerId" | "locked">): boolean {
    return element.locked || this.layersStore.resolve(element.layerId).locked;
  }

  /**
   * The sorted elements a pointer interaction may target: hidden-layer and effectively-locked
   * elements are out (soft-deleted ones are left for each consumer's existing filter, which every
   * hit/marquee/lasso path already has). The one list click-hit, marquee, and lasso all start from,
   * so a gating rule can never drift between them.
   */
  selectableElements(): AnyElement[] {
    return this.getElements().filter((element) => !this.isElementHidden(element) && !this.effectiveLocked(element));
  }

  setActiveLayer(id: string): void {
    if (this.layersStore.setActiveLayer(id)) this.notify();
  }

  /** Appends a new layer on top and returns it (not activated — that's the caller's choice). */
  addLayer(name?: string): SceneLayer {
    const layer = this.layersStore.addLayer(name);
    this.notify();
    return layer;
  }

  renameLayer(id: string, name: string): void {
    if (this.layersStore.renameLayer(id, name)) this.notify();
  }

  setLayerVisible(id: string, visible: boolean): void {
    if (this.layersStore.setLayerVisible(id, visible)) this.notify();
  }

  setLayerLocked(id: string, locked: boolean): void {
    if (this.layersStore.setLayerLocked(id, locked)) this.notify();
  }

  /** One step toward the top (+1) or bottom (-1). */
  moveLayer(id: string, direction: 1 | -1): void {
    if (this.layersStore.moveLayer(id, direction)) this.notify();
  }

  /**
   * Deletes a layer, re-homing its elements (including soft-deleted ones, so a later undo doesn't
   * resurrect membership pointing at a layer that never comes back) onto `destinationLayerId`
   * FIRST — the re-homes are ordinary `updateElement` mutations, so they bump versions and land in
   * whatever history batch the caller opened; the list-entry removal itself is not undoable.
   * Refused for the last remaining layer or an unknown destination.
   */
  removeLayer(id: string, destinationLayerId: string): boolean {
    if (this.layersStore.layerCount() <= 1 || id === destinationLayerId) return false;
    if (!this.layersStore.getLayer(id) || !this.layersStore.getLayer(destinationLayerId)) return false;
    const destination = destinationLayerId === this.layersStore.getDefaultLayerId() ? undefined : destinationLayerId;
    for (const element of [...this.elements.values()]) {
      if (this.layersStore.resolve(element.layerId).id === id) this.updateElement(element.id, { layerId: destination });
    }
    if (this.layersStore.removeLayer(id)) this.notify();
    return true;
  }

  /** Replaces the whole layer list from a deserialized document or a winning remote manifest — refused (returning `false`, scene untouched) for an empty or oversized list, the hostile-input guard. */
  replaceLayers(layers: readonly SceneLayer[], activeLayerId?: string): boolean {
    const changed = this.layersStore.replaceAll(layers, activeLayerId);
    if (changed) this.notify();
    return changed;
  }

  /** True when the layer list is indistinguishable from a fresh scene's — serialization omits it then, keeping untouched scenes byte-identical to pre-layers output. */
  hasNonTrivialLayers(): boolean {
    return !this.layersStore.isTrivial();
  }

  /** O(1) monotonic layer-mutation counter — lets hot-path subscribers skip work on the (vastly more frequent) element-only notifies. */
  getLayersVersion(): number {
    return this.layersStore.getVersion();
  }

  /** The LWW envelope collab snapshots carry for this scene's layers — version 0 means "never locally mutated" (senders may omit it). */
  getLayersManifest(): LayersManifest {
    return this.layersStore.getManifest();
  }

  /** Wholesale LWW adoption of a peer's layers manifest — see `SceneLayersStore.applyRemoteManifest` for the win rule and the deliberate no-union divergence from pages. Notifies on adoption (which also re-runs the selection prune and repaints). */
  applyRemoteLayersManifest(manifest: LayersManifest): boolean {
    const adopted = this.layersStore.applyRemoteManifest(manifest);
    if (adopted) this.notify();
    return adopted;
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

  /**
   * Inserts or overwrites `element` with its exact given fields — no `version`/`versionNonce`/`updated`
   * bump, unlike `updateElement`'s `touch()` — then runs every registered update hook against it and
   * notifies subscribers. This is the remote-merge insertion point a collaboration client's
   * last-writer-wins resolver calls once it has already decided (by comparing `version`/`versionNonce`)
   * that a remote element should replace the local one: the winning element must land locally with the
   * identical version/versionNonce/content the sender produced, byte-for-byte, or two peers that both
   * receive the same delta would each mint their own fresh version via `touch()` and never converge to
   * an identical final state. Hooks still run (e.g. rerouting a bound arrow) so any locally-only
   * relationship stays consistent even in the rare case the sender's own hook pass didn't already cover
   * it for this peer — a redundant, idempotent no-op in the common case.
   *
   * Also the correct primitive for inserting a brand-new remote element (one with no local counterpart
   * yet): unlike `restoreElement`, this never throws on an unknown id, so a resolver doesn't need a
   * separate exists-check branch before calling it.
   */
  applyRemoteElement(element: AnyElement): AnyElement {
    const frozen = freezeElement(element);
    this.elements.set(frozen.id, frozen);
    this.runUpdateHooks(frozen);
    this.notify();
    return frozen;
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

  /**
   * Runs `mutate` with subscriber notification collapsed into a single dispatch at the end, instead
   * of one per mutation.
   *
   * Every notification is cheap on its own, but subscribers are per-*change*, not per-element:
   * dragging a 10 000-element selection updates 10 000 elements per pointer move, and each update
   * separately invalidated the static layer, bumped a React version counter, and reset two debounce
   * timers. The work is identical whether it happens once or ten thousand times per frame — so it
   * happens once.
   *
   * Update *hooks* are deliberately NOT deferred: they still run inline per element (see
   * `registerUpdateHook`), because a hook is a domain cascade — a bound arrow must reroute as part
   * of the same mutation that moved its shape, not a frame later. Only the outward notification
   * waits.
   *
   * Nested calls join the outermost batch, so a hook that mutates the scene cannot end the batch
   * early. If `mutate` throws, the notification still fires for whatever it already changed —
   * subscribers must never be left stale about mutations that really happened.
   *
   * That flush runs in a `finally`, which is why it is guarded: an exception escaping it would
   * *replace* whatever `mutate` was throwing, so a failing listener would erase the real bug and
   * leave only its own error visible. The listener failure is logged and swallowed, exactly as
   * `runUpdateHooks` isolates a throwing hook, and the original exception propagates untouched.
   */
  batch<T>(mutate: () => T): T {
    if (this.batching) return mutate();
    this.batching = true;
    try {
      return mutate();
    } finally {
      this.batching = false;
      if (this.batchPending) {
        this.batchPending = false;
        try {
          this.notify();
        } catch (error) {
          console.error("scene: a listener threw while flushing a batch", error);
        }
      }
    }
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
    // Inside a batch the dispatch is collapsed to one call on exit — see `batch()`.
    if (this.batching) {
      this.batchPending = true;
      return;
    }
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
