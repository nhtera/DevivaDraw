/**
 * The scene's layer list: ordered bottom→top, always at least one entry. Composed by `Scene` the
 * same way `SceneFilesStore` is — the store self-initializes a default layer in its constructor
 * with zero caller involvement, which is a hard invariant: every `new Scene()` site in the
 * codebase is a bare zero-arg call that must come up with a valid, visible, unlocked layer.
 *
 * Membership convention: an element on the DEFAULT layer carries no `layerId` at all, and only
 * non-default membership is stamped — so a scene that never touches layers serializes byte-identical
 * to a pre-layers build, and a legacy document is simply "everything on the default layer".
 * `resolve()` therefore maps `undefined` AND any unknown id (an orphan from a legacy round-trip or
 * a not-yet-arrived collab manifest) to the default layer — at READ TIME ONLY, never by rewriting
 * the element's stored id, so a late-arriving layer with that id reunites its elements untouched.
 */
import { randomInt } from "../elements/element-factory-defaults";

export interface SceneLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

/** Upper bound a document/remote manifest may carry — a cap against hostile inputs, far above any real board. */
export const MAX_LAYERS = 256;

export const DEFAULT_LAYER_NAME = "Layer 1";

function generateLayerId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${randomInt().toString(36)}`;
}

export class SceneLayersStore {
  private layers: SceneLayer[];
  /**
   * The layer that owns unstamped (`layerId === undefined`) elements and absorbs orphans. Tracked
   * by ID, not position: reordering must never silently re-home the unstamped population.
   */
  private defaultId: string;
  private activeId: string;
  /** id → position (bottom = 0), rebuilt on every mutation so per-element sort lookups stay O(1). */
  private positions = new Map<string, number>();

  constructor() {
    const initial: SceneLayer = { id: generateLayerId(), name: DEFAULT_LAYER_NAME, visible: true, locked: false };
    this.layers = [initial];
    this.defaultId = initial.id;
    this.activeId = initial.id;
    this.rebuildPositions();
  }

  /** Bottom→top copies — callers can't mutate store state through the return value. */
  getLayers(): SceneLayer[] {
    return this.layers.map((layer) => ({ ...layer }));
  }

  getLayer(id: string): SceneLayer | undefined {
    const layer = this.layers.find((entry) => entry.id === id);
    return layer ? { ...layer } : undefined;
  }

  layerCount(): number {
    return this.layers.length;
  }

  getDefaultLayerId(): string {
    return this.defaultId;
  }

  getActiveLayerId(): string {
    return this.activeId;
  }

  /** Returns whether anything changed — unknown ids are ignored rather than corrupting the active pointer. */
  setActiveLayer(id: string): boolean {
    if (this.activeId === id || !this.positions.has(id)) return false;
    this.activeId = id;
    return true;
  }

  /**
   * The effective layer for a membership value: `undefined` and unknown ids resolve to the default
   * layer (read-time only — see the module doc). Falls back to the bottom layer if the default was
   * itself deleted out from under an orphan.
   */
  resolve(layerId: string | undefined): SceneLayer {
    const id = layerId !== undefined && this.positions.has(layerId) ? layerId : this.defaultId;
    return this.layers[this.positions.get(id) ?? 0] ?? this.layers[0]!;
  }

  /** Sort key for the layer-first z comparator — position of the element's effective layer. */
  positionOf(layerId: string | undefined): number {
    if (layerId !== undefined) {
      const position = this.positions.get(layerId);
      if (position !== undefined) return position;
    }
    return this.positions.get(this.defaultId) ?? 0;
  }

  /** Appends a new visible, unlocked layer on TOP and returns it. Does not change the active layer — activation is the caller's (panel's) choice. */
  addLayer(name?: string): SceneLayer {
    const layer: SceneLayer = { id: generateLayerId(), name: name ?? `Layer ${this.layers.length + 1}`, visible: true, locked: false };
    this.layers.push(layer);
    this.rebuildPositions();
    return { ...layer };
  }

  renameLayer(id: string, name: string): boolean {
    const layer = this.layers.find((entry) => entry.id === id);
    const trimmed = name.trim();
    if (!layer || trimmed === "" || layer.name === trimmed) return false;
    layer.name = trimmed;
    return true;
  }

  setLayerVisible(id: string, visible: boolean): boolean {
    const layer = this.layers.find((entry) => entry.id === id);
    if (!layer || layer.visible === visible) return false;
    layer.visible = visible;
    return true;
  }

  setLayerLocked(id: string, locked: boolean): boolean {
    const layer = this.layers.find((entry) => entry.id === id);
    if (!layer || layer.locked === locked) return false;
    layer.locked = locked;
    return true;
  }

  /** Moves the layer one step up (+1, toward the top) or down (-1). Returns whether anything moved. */
  moveLayer(id: string, direction: 1 | -1): boolean {
    const from = this.positions.get(id);
    if (from === undefined) return false;
    const to = from + direction;
    if (to < 0 || to >= this.layers.length) return false;
    const [layer] = this.layers.splice(from, 1);
    this.layers.splice(to, 0, layer!);
    this.rebuildPositions();
    return true;
  }

  /**
   * Removes a layer — refused for the last remaining one. The caller (Scene) is responsible for
   * re-homing the removed layer's elements FIRST; this store only manages the list. A removed
   * default layer hands the default role to the bottom layer so orphan resolution stays anchored.
   */
  removeLayer(id: string): boolean {
    if (this.layers.length <= 1) return false;
    const position = this.positions.get(id);
    if (position === undefined) return false;
    this.layers.splice(position, 1);
    this.rebuildPositions();
    if (this.defaultId === id) this.defaultId = this.layers[0]!.id;
    if (this.activeId === id) this.activeId = this.layers[Math.min(position, this.layers.length - 1)]!.id;
    return true;
  }

  /**
   * Replaces the whole list from a deserialized document (or, later, a winning remote manifest).
   * An empty input is refused — the ≥1 invariant holds against hostile/corrupt sources, matching
   * the pages-manifest guard. The default role goes to the bottom layer (documents don't record it;
   * the bottom layer is where legacy/unstamped content lands, which is what "default" means).
   */
  replaceAll(layers: readonly SceneLayer[], activeLayerId?: string): boolean {
    if (layers.length === 0 || layers.length > MAX_LAYERS) return false;
    this.layers = layers.map((layer) => ({ ...layer }));
    this.rebuildPositions();
    this.defaultId = this.layers[0]!.id;
    this.activeId = activeLayerId !== undefined && this.positions.has(activeLayerId) ? activeLayerId : this.defaultId;
    return true;
  }

  /** True when the list is indistinguishable from a fresh store: one default-named, visible, unlocked layer. Serialization omits trivial lists so untouched scenes stay byte-identical to pre-layers output. */
  isTrivial(): boolean {
    if (this.layers.length !== 1) return false;
    const only = this.layers[0]!;
    return only.name === DEFAULT_LAYER_NAME && only.visible && !only.locked;
  }

  private rebuildPositions(): void {
    this.positions = new Map(this.layers.map((layer, position) => [layer.id, position]));
  }
}
